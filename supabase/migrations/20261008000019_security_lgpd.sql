-- Segurança e LGPD (lista de QA, itens 24 e 25).
-- 24. Limite de requisições em lance, arremate e checagem de apelido/WhatsApp, antes de
--     a requisição chegar à função (pgrst.db_pre_request do PostgREST).
-- 25. Aceite dos termos e da política no cadastro (data gravada) e exclusão da conta pelo
--     próprio comprador. Na exclusão, nome, apelido, e-mail e endereço somem; CPF e
--     WhatsApp ficam guardados para manter bloqueios e evitar fraude, e pedidos pagos
--     ficam pelo prazo legal (ver /privacidade).

-- ---------------------------------------------------------------------------
-- 24. Limite de requisições
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.rate_hits (
  key text not null,
  bucket timestamptz not null,
  hits int not null default 1,
  primary key (key, bucket)
);

-- Janela fixa: até p_max chamadas por p_window_seconds para a mesma chave.
create or replace function private.rate_allow(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = private, public
as $$
declare
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_hits (key, bucket) values (p_key, v_bucket)
  on conflict (key, bucket) do update set hits = private.rate_hits.hits + 1
  returning hits into v_hits;
  -- limpeza ocasional das janelas antigas
  if random() < 0.01 then
    delete from private.rate_hits where bucket < clock_timestamp() - interval '1 hour';
  end if;
  return v_hits <= p_max;
end;
$$;

create or replace function public.app_check_request()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path text := coalesce(current_setting('request.path', true), '');
  v_ip text := nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  v_ok boolean := true;
begin
  -- leituras (GET e funções stable) rodam em transação só de leitura: não dá para contar ali
  if current_setting('transaction_read_only', true) = 'on' then
    return;
  end if;
  if v_path in ('/rpc/place_bid', '/rpc/buy_now', 'rpc/place_bid', 'rpc/buy_now') then
    -- toques de verdade cabem com folga; um robô disparando lances não
    v_ok := private.rate_allow('bid:' || coalesce(auth.uid()::text, v_ip, 'anon'), 15, 10);
  elsif v_path in ('/rpc/nickname_available', '/rpc/whatsapp_available', 'rpc/nickname_available', 'rpc/whatsapp_available') then
    v_ok := private.rate_allow('check:' || coalesce(v_ip, auth.uid()::text, 'anon'), 40, 60);
  end if;
  if not v_ok then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', 'rate_limited', 'message', 'Muitas tentativas seguidas. Espere alguns segundos.')::text,
      detail = json_build_object('status', 429, 'headers', json_build_object('Retry-After', '10'))::text;
  end if;
end;
$$;

-- As checagens do cadastro passam a rodar em transação de escrita (POST), para o limite contar.
alter function public.nickname_available(text) volatile;
alter function public.whatsapp_available(text) volatile;

revoke execute on function private.rate_allow(text, int, int) from public, anon, authenticated;
revoke execute on function public.app_check_request() from public;
grant execute on function public.app_check_request() to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.app_check_request';
    notify pgrst, 'reload config';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 25. Aceite dos termos
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

-- Cadastro pelo app precisa do aceite (o formulário manda terms_version). Roda depois
-- de on_auth_user_created, que cria o perfil.
create or replace function public.app_record_terms()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if m ->> 'nickname' is null then
    return new; -- usuário criado pelo painel do Supabase
  end if;
  if coalesce(m ->> 'terms_version', '') = '' then
    raise exception 'terms_required' using errcode = 'check_violation';
  end if;
  update public.profiles set terms_accepted_at = clock_timestamp(), terms_version = left(m ->> 'terms_version', 20) where id = new.id;
  return new;
end;
$$;

-- O gatilho que exige o aceite fica em 20261008000020 (aplicar depois do deploy do formulário novo).

revoke execute on function public.app_record_terms() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 25. Exclusão da conta pelo próprio comprador
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select * into p from public.profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'profile_required'); end if;
  if p.role = 'admin' then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  -- cartas guardadas ou pedido em andamento: precisa terminar antes (o leiloeiro tem a carta / o pagamento)
  if exists (select 1 from public.wins w join public.lots l on l.id = w.lot_id
              where l.user_id = v_uid and l.status = 'open' and w.status = 'stored') then
    return jsonb_build_object('ok', false, 'code', 'pending_lot');
  end if;
  if exists (select 1 from public.orders where user_id = v_uid
              and status in ('awaiting_shipping_quote', 'awaiting_payment', 'proof_sent', 'paid', 'shipped')) then
    return jsonb_build_object('ok', false, 'code', 'pending_orders');
  end if;

  -- bloqueada também: o token já emitido ainda vale por alguns minutos e não pode dar lance
  update public.profiles
     set full_name = 'Conta excluída', nickname = 'excluido-' || right(replace(v_uid::text, '-', ''), 20), status = 'blocked'
   where id = v_uid;
  delete from public.addresses where user_id = v_uid;
  update public.notifications set body = null, data = '{}'::jsonb where user_id = v_uid;
  update auth.users
     set email = 'excluido+' || v_uid || '@invalid.local', raw_user_meta_data = '{}'::jsonb,
         encrypted_password = '', banned_until = '2999-12-31'
   where id = v_uid;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using v_uid;
  end if;
  perform public.app_audit(s.id, 'user.delete_self', 'profile', v_uid)
     from public.sellers s
    where exists (select 1 from public.lots l where l.seller_id = s.id and l.user_id = v_uid);
  return jsonb_build_object('ok', true, 'code', 'account_deleted');
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
