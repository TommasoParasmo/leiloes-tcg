-- Criar leilão em um passo (pedido do Tom: menos passos para o leiloeiro).
-- O leiloeiro escolhe o dia e toca nas cartas; todas entram com o lance padrão da loja
-- (R$ 5, botões +1/+2/+5, 20 segundos) e o leilão já sai publicado. Quem quiser muda
-- carta por carta depois, na tela do evento.

alter table public.sellers
  add column default_start_price_cents bigint not null default 500 check (default_start_price_cents between 1 and 10000000),
  add column default_increments_cents bigint[] not null default '{100,200,500}'
    check (cardinality(default_increments_cents) between 1 and 3 and 0 < all (default_increments_cents)),
  add column default_duration_seconds int not null default 20 check (default_duration_seconds between 5 and 3600);

-- Lance padrão da loja (o "Mudar" da tela de criar leilão).
create or replace function public.admin_update_round_defaults(p_start_price_cents bigint, p_increments_cents bigint[], p_duration_seconds int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := public.app_my_seller();
begin
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_start_price_cents is null or p_start_price_cents not between 1 and 10000000
     or p_increments_cents is null or cardinality(p_increments_cents) not between 1 and 3
     or not (0 < all (p_increments_cents)) or exists (select 1 from unnest(p_increments_cents) x where x is null or x > 10000000)
     or p_duration_seconds is null or p_duration_seconds not between 5 and 3600 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  update public.sellers
     set default_start_price_cents = p_start_price_cents,
         default_increments_cents = (select array_agg(x order by x) from unnest(p_increments_cents) x),
         default_duration_seconds = p_duration_seconds
   where id = v_seller;
  perform public.app_audit(v_seller, 'store.round_defaults', 'seller', v_seller,
                           jsonb_build_object('start', p_start_price_cents, 'increments', p_increments_cents, 'seconds', p_duration_seconds));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

-- Cria o leilão, põe as cartas na ordem escolhida com o lance padrão e publica. Tudo ou nada.
create or replace function public.admin_create_quick_event(p_title text, p_starts_at timestamptz, p_card_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := public.app_my_seller();
  s public.sellers;
  v_id uuid;
  v_number int;
  v_card uuid;
  v_pos int := 0;
begin
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if coalesce(length(trim(p_title)), 0) not between 1 and 120 or p_starts_at is null
     or coalesce(cardinality(p_card_ids), 0) not between 1 and 300
     or (select count(distinct x) from unnest(p_card_ids) x) <> cardinality(p_card_ids)
     or array_position(p_card_ids, null) is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- trava o leiloeiro: número do leilão e cartas não são disputados por dois cadastros ao mesmo tempo
  select * into s from public.sellers where id = v_seller for update;
  perform 1 from public.cards where id = any (p_card_ids) for update;
  foreach v_card in array p_card_ids loop
    if not exists (select 1 from public.cards where id = v_card and seller_id = v_seller) then
      return jsonb_build_object('ok', false, 'code', 'card_not_found', 'card_id', v_card);
    end if;
    if exists (select 1 from public.rounds where card_id = v_card and status in ('queued', 'open', 'paused'))
       or exists (select 1 from public.wins where card_id = v_card and status <> 'cancelled') then
      return jsonb_build_object('ok', false, 'code', 'card_unavailable', 'card_id', v_card);
    end if;
  end loop;

  select coalesce(max(number), 0) + 1 into v_number from public.events where seller_id = v_seller;
  insert into public.events (seller_id, number, title, starts_at, status)
  values (v_seller, v_number, trim(p_title), p_starts_at, 'scheduled')
  returning id into v_id;

  foreach v_card in array p_card_ids loop
    v_pos := v_pos + 1;
    insert into public.rounds (seller_id, event_id, card_id, position, mode, start_price_cents, increments_cents,
                               close_mode, duration_seconds)
    values (v_seller, v_id, v_card, v_pos, 'highest_bid', s.default_start_price_cents, s.default_increments_cents,
            'timer', s.default_duration_seconds);
  end loop;

  perform public.app_audit(v_seller, 'event.create', 'event', v_id, jsonb_build_object('quick', true, 'cards', v_pos));
  perform public.app_audit(v_seller, 'event.publish', 'event', v_id);
  return jsonb_build_object('ok', true, 'code', 'published', 'id', v_id, 'number', v_number);
end;
$$;

revoke execute on function public.admin_update_round_defaults(bigint, bigint[], int) from public, anon;
revoke execute on function public.admin_create_quick_event(text, timestamptz, uuid[]) from public, anon;
grant execute on function public.admin_update_round_defaults(bigint, bigint[], int) to authenticated;
grant execute on function public.admin_create_quick_event(text, timestamptz, uuid[]) to authenticated;
