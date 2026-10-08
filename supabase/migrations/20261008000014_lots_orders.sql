-- Fechamento de lote, pedido, frete manual, Pix com comprovante, confirmação pelo
-- leiloeiro, cartão amarelo automático (um por pedido vencido), bloqueio no 2º e
-- desbloqueio só pelo admin com justificativa. Também: CPF obrigatório antes do
-- primeiro lance e WhatsApp/CPF únicos (quem foi bloqueado não volta com outra conta).
--
-- Prazo do Pix (decisão do Tom, 08/10):
--   * sem acumulação: payment_days (7) a partir do fim do 1º leilão do lote;
--   * com acumulação: 24h depois do fim do último leilão permitido (o 2º);
--   * nunca vence antes de 24h depois de o frete ser cotado (atraso do leiloeiro
--     não vira cartão amarelo do comprador).

-- ---------------------------------------------------------------------------
-- Acumulação conta só eventos que aconteceram (ao vivo ou encerrados). Um evento
-- criado e abandonado em rascunho/agendado não consome o limite de ninguém.
-- ---------------------------------------------------------------------------
create or replace function public.app_lot_event_count(p_lot public.lots, p_event_number int)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.events e
  where e.seller_id = p_lot.seller_id
    and e.status in ('live', 'finished')
    and e.number between p_lot.first_event_number and p_event_number;
$$;

-- Prazo de pagamento do lote, ou null enquanto o 1º leilão não terminou.
create or replace function public.app_lot_due_at(p_lot public.lots)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  with ev as (
    select e.finished_at, row_number() over (order by e.number) as n
      from public.events e
     where e.seller_id = p_lot.seller_id
       and e.status in ('live', 'finished')
       and e.number >= p_lot.first_event_number
  ), s as (
    select payment_days, max_accumulation_events from public.sellers where id = p_lot.seller_id
  )
  select least(
           (select ev.finished_at from ev where n = 1) + make_interval(days => s.payment_days),
           (select ev.finished_at from ev where n = s.max_accumulation_events) + interval '24 hours'
         )
    from s;
$$;

-- ---------------------------------------------------------------------------
-- Penalidade: uma por pedido (não por pagamento), para recusa + novo pagamento
-- não gerarem um segundo cartão pela mesma dívida.
-- ---------------------------------------------------------------------------
alter table public.penalties add column if not exists order_id uuid unique references public.orders (id);

-- ---------------------------------------------------------------------------
-- Cadastro único: WhatsApp e CPF não se repetem entre contas.
-- ---------------------------------------------------------------------------
-- Mesmo número com ou sem o 55 (+55 21 99999-0001 e 21 99999-0001) conta como um só.
create or replace function public.app_norm_whatsapp(p_whatsapp text)
returns text
language sql immutable set search_path = public
as $$
  select case when d ~ '^55[0-9]{10,11}$' then substr(d, 3) else d end
    from (select regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g') as d) x;
$$;

drop index if exists public.profiles_whatsapp_unique;
create unique index profiles_whatsapp_unique on public.profiles ((public.app_norm_whatsapp(whatsapp)));
create unique index if not exists profiles_cpf_unique on public.profiles (cpf) where cpf is not null;

-- CPF com dígitos verificadores válidos (11 dígitos, sem todos iguais).
create or replace function public.app_valid_cpf(p_cpf text)
returns boolean
language plpgsql immutable set search_path = public
as $$
declare
  d int[];
  s int;
  i int;
  v1 int;
  v2 int;
begin
  if p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^(.)\1{10}$' then
    return false;
  end if;
  d := array(select substr(p_cpf, g, 1)::int from generate_series(1, 11) g);
  s := 0;
  for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  v1 := (s * 10) % 11 % 10;
  s := 0;
  for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  v2 := (s * 10) % 11 % 10;
  return v1 = d[10] and v2 = d[11];
end;
$$;

-- Todo CPF gravado é válido, venha do cadastro (metadata) ou de onde for.
alter table public.profiles drop constraint if exists profiles_cpf_valid;
alter table public.profiles add constraint profiles_cpf_valid check (cpf is null or public.app_valid_cpf(cpf));

-- Perfil só nasce pelo gatilho do cadastro (handle_new_user): ninguém insere a própria linha.
revoke insert on public.profiles from anon, authenticated;

-- WhatsApp livre? (o cadastro avisa antes de enviar)
create or replace function public.whatsapp_available(p_whatsapp text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select length(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g')) between 10 and 15
     and not exists (select 1 from public.profiles
                      where public.app_norm_whatsapp(whatsapp) = public.app_norm_whatsapp(p_whatsapp));
$$;
revoke execute on function public.whatsapp_available(text) from public;
grant execute on function public.whatsapp_available(text) to anon, authenticated;

-- Comprador informa o CPF (exigido antes do primeiro lance).
create or replace function public.complete_profile(p_cpf text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_current text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select cpf into v_current from public.profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'profile_required'); end if;
  if v_current is not null then return jsonb_build_object('ok', false, 'code', 'cpf_already_set'); end if;
  if not public.app_valid_cpf(v_cpf) then return jsonb_build_object('ok', false, 'code', 'invalid_cpf'); end if;
  if exists (select 1 from public.profiles where cpf = v_cpf) then
    return jsonb_build_object('ok', false, 'code', 'cpf_taken');
  end if;
  update public.profiles set cpf = v_cpf where id = v_uid;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;
revoke execute on function public.complete_profile(text) from public, anon;
grant execute on function public.complete_profile(text) to authenticated;

-- Quem ainda não informou o CPF não lança nem arremata.
create or replace function public.app_participation_block(p_user uuid, p_round public.rounds)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_profile public.profiles;
  v_lot public.lots;
  v_event_number int;
  v_max int;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return 'profile_required';
  end if;
  if v_profile.status = 'blocked' then
    return 'blocked';
  end if;
  if v_profile.cpf is null then
    return 'cpf_required';
  end if;

  select * into v_lot from public.lots
  where seller_id = p_round.seller_id and user_id = p_user and status = 'open';
  if found then
    select number into v_event_number from public.events where id = p_round.event_id;
    select max_accumulation_events into v_max from public.sellers where id = p_round.seller_id;
    if public.app_lot_event_count(v_lot, v_event_number) > v_max then
      return 'must_close_lot';
    end if;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fechar lote → pedido aguardando frete.
-- ---------------------------------------------------------------------------
create or replace function public.app_close_lot(p_lot_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_lot public.lots;
  v_order uuid;
  v_subtotal bigint;
  v_addr public.addresses;
  v_seller public.sellers;
begin
  select * into v_lot from public.lots where id = p_lot_id for update;
  if not found or v_lot.status <> 'open' then return null; end if;
  select * into v_seller from public.sellers where id = v_lot.seller_id;

  select coalesce(sum(amount_cents), 0) into v_subtotal from public.wins where lot_id = v_lot.id and status <> 'cancelled';
  select * into v_addr from public.addresses where user_id = v_lot.user_id order by is_default desc, created_at desc limit 1;

  update public.lots set status = 'closed', closed_at = clock_timestamp() where id = v_lot.id;
  if v_subtotal = 0 then
    return null; -- todas as cartas canceladas: nada a cobrar
  end if;

  insert into public.orders (seller_id, user_id, lot_id, address_id, shipping_address, subtotal_cents, status, due_at)
  values (
    v_lot.seller_id, v_lot.user_id, v_lot.id, v_addr.id,
    case when v_addr.id is null then null else to_jsonb(v_addr) - 'id' - 'user_id' - 'created_at' - 'is_default' - 'label' end,
    v_subtotal, 'awaiting_shipping_quote',
    coalesce(public.app_lot_due_at(v_lot), clock_timestamp() + make_interval(days => v_seller.payment_days))
  )
  returning id into v_order;
  update public.wins set status = 'in_order' where lot_id = v_lot.id and status = 'stored';

  perform public.app_audit(v_lot.seller_id, 'lot.close', 'lot', v_lot.id, jsonb_build_object('reason', p_reason, 'order_id', v_order));
  perform public.app_notify(v_lot.user_id, 'lot_closed', 'Lote fechado',
    'Total das cartas: ' || public.app_brl(v_subtotal) || '. Assim que o frete for calculado, o Pix fica disponível.',
    jsonb_build_object('order_id', v_order));
  return v_order;
end;
$$;

create or replace function public.close_my_lot(p_lot_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_lot public.lots;
  v_order uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select * into v_lot from public.lots where id = p_lot_id for update;
  if not found or v_lot.user_id <> auth.uid() then return jsonb_build_object('ok', false, 'code', 'lot_not_found'); end if;
  if v_lot.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'lot_already_closed'); end if;
  if not exists (select 1 from public.addresses where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'code', 'address_required');
  end if;
  v_order := public.app_close_lot(v_lot.id, 'buyer');
  return jsonb_build_object('ok', true, 'code', 'lot_closed', 'order_id', v_order);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rotina (cron a cada minuto e ao encerrar evento):
--   1. fecha lotes que chegaram ao limite de leilões ou cujo prazo passou;
--   2. dá cartão amarelo em pedido com frete cotado e Pix vencido (um por pedido);
--   3. bloqueia quem chega a 2 cartões ativos.
-- ---------------------------------------------------------------------------
create or replace function public.app_process_lots()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_lot public.lots;
  v_order public.orders;
  v_closed int := 0;
  v_penalties int := 0;
  v_active int;
begin
  for v_lot in
    select l.* from public.lots l
      join public.sellers s on s.id = l.seller_id
     where l.status = 'open'
       and (
         (select count(*) from public.events e
           where e.seller_id = l.seller_id and e.status = 'finished' and e.number >= l.first_event_number) >= s.max_accumulation_events
         or public.app_lot_due_at(l) <= clock_timestamp()
       )
     for update of l skip locked
  loop
    perform public.app_close_lot(v_lot.id, 'automatic');
    v_closed := v_closed + 1;
  end loop;

  for v_order in
    select o.* from public.orders o
     where o.status = 'awaiting_payment' and o.due_at <= clock_timestamp()
       and not exists (select 1 from public.penalties p where p.order_id = o.id)
     for update of o skip locked
  loop
    insert into public.penalties (seller_id, user_id, order_id, reason)
    values (v_order.seller_id, v_order.user_id, v_order.id,
            'Pix não pago no prazo (' || to_char(v_order.due_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ')')
    on conflict do nothing;
    v_penalties := v_penalties + 1;
    perform public.app_audit(v_order.seller_id, 'penalty.issue', 'order', v_order.id);

    select count(*) into v_active from public.penalties where user_id = v_order.user_id and removed_at is null;
    if v_active >= 2 then
      update public.profiles set status = 'blocked', blocked_at = clock_timestamp()
       where id = v_order.user_id and status = 'active';
      perform public.app_notify(v_order.user_id, 'blocked', 'Conta bloqueada para lances',
        'Você recebeu o 2º cartão amarelo. Regularize o pagamento e fale com o leiloeiro.', jsonb_build_object('order_id', v_order.id));
    else
      perform public.app_notify(v_order.user_id, 'penalty', 'Você recebeu um cartão amarelo',
        'O Pix do seu pedido venceu. Pague o quanto antes: um 2º cartão bloqueia novos lances.', jsonb_build_object('order_id', v_order.id));
    end if;
  end loop;

  return jsonb_build_object('lots_closed', v_closed, 'penalties', v_penalties);
end;
$$;

-- Encerrar o evento já fecha os lotes que chegaram ao limite, sem esperar o cron.
create or replace function public.admin_finish_event(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_left int;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_event.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_event.status in ('finished', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'event_already_finished'); end if;
  if exists (select 1 from public.rounds where event_id = p_event_id and status in ('open', 'paused')) then
    return jsonb_build_object('ok', false, 'code', 'another_round_active');
  end if;
  update public.rounds set status = 'cancelled', cancel_reason = 'Evento encerrado'
   where event_id = p_event_id and status = 'queued';
  get diagnostics v_left = row_count;
  update public.events set status = 'finished', finished_at = clock_timestamp() where id = p_event_id;
  perform public.app_audit(v_event.seller_id, 'event.finish', 'event', p_event_id, jsonb_build_object('unsold', v_left));
  perform public.app_process_lots();
  return jsonb_build_object('ok', true, 'code', 'finished', 'unsold', v_left);
end;
$$;

-- ---------------------------------------------------------------------------
-- Frete (cotação manual por enquanto; SuperFrete entra depois) e pagamento.
-- ---------------------------------------------------------------------------
create or replace function public.admin_quote_shipping(p_order_id uuid, p_price_cents bigint, p_service text, p_days int default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('awaiting_shipping_quote', 'awaiting_payment') then
    return jsonb_build_object('ok', false, 'code', 'order_wrong_status');
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 10000000
     or coalesce(length(trim(p_service)), 0) not between 1 and 80
     or (p_days is not null and p_days not between 1 and 90) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  update public.orders
     set shipping_cents = p_price_cents,
         status = 'awaiting_payment',
         due_at = greatest(coalesce(due_at, clock_timestamp()), clock_timestamp() + interval '24 hours')
   where id = o.id
   returning * into o;

  insert into public.shipments (seller_id, order_id, service_name, price_cents, delivery_days, quote_is_manual, status)
  values (o.seller_id, o.id, trim(p_service), p_price_cents, p_days, true, 'quoted')
  on conflict (order_id) do update
    set service_name = excluded.service_name, price_cents = excluded.price_cents,
        delivery_days = excluded.delivery_days, quote_is_manual = true, status = 'quoted';

  -- um pagamento pendente por vez, sempre com o total atual
  update public.payments set status = 'cancelled' where order_id = o.id and status = 'pending';
  insert into public.payments (seller_id, order_id, amount_cents, due_at)
  values (o.seller_id, o.id, o.total_cents, o.due_at);

  perform public.app_audit(o.seller_id, 'order.quote', 'order', o.id, jsonb_build_object('shipping_cents', p_price_cents));
  perform public.app_notify(o.user_id, 'payment_ready', 'Seu Pix está pronto',
    'Total com frete: ' || public.app_brl(o.total_cents) || '. Pague até ' ||
    to_char(o.due_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.',
    jsonb_build_object('order_id', o.id));
  return jsonb_build_object('ok', true, 'code', 'quoted', 'total_cents', o.total_cents, 'due_at', o.due_at);
end;
$$;

create or replace function public.submit_payment_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.user_id <> auth.uid() then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if o.status not in ('awaiting_payment', 'proof_sent') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if p_proof_path is null or p_proof_path not like auth.uid()::text || '/' || o.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  update public.payments set status = 'proof_sent', proof_path = p_proof_path, proof_sent_at = clock_timestamp()
   where order_id = o.id and status in ('pending', 'proof_sent');
  update public.orders set status = 'proof_sent' where id = o.id;
  perform public.app_audit(o.seller_id, 'payment.proof', 'order', o.id);
  return jsonb_build_object('ok', true, 'code', 'proof_sent');
end;
$$;

create or replace function public.admin_confirm_payment(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('awaiting_payment', 'proof_sent') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  update public.payments set status = 'confirmed', confirmed_at = clock_timestamp(), confirmed_by = auth.uid()
   where order_id = o.id and status in ('pending', 'proof_sent');
  update public.orders set status = 'paid' where id = o.id;
  update public.wins set status = 'paid' where lot_id = o.lot_id and status = 'in_order';
  perform public.app_audit(o.seller_id, 'payment.confirm', 'order', o.id);
  perform public.app_notify(o.user_id, 'payment_confirmed', 'Pagamento confirmado',
    'Recebemos seu Pix de ' || public.app_brl(o.total_cents) || '. Agora é com o envio.', jsonb_build_object('order_id', o.id));
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$$;

create or replace function public.admin_reject_payment(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status <> 'proof_sent' then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if coalesce(length(trim(p_reason)), 0) not between 1 and 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  update public.payments set status = 'rejected' where order_id = o.id and status = 'proof_sent';
  -- comprovante recusado: pelo menos 24h para reenviar antes do cartão amarelo
  o.due_at := greatest(o.due_at, clock_timestamp() + interval '24 hours');
  insert into public.payments (seller_id, order_id, amount_cents, due_at) values (o.seller_id, o.id, o.total_cents, o.due_at);
  update public.orders set status = 'awaiting_payment', notes = trim(p_reason), due_at = o.due_at where id = o.id;
  perform public.app_audit(o.seller_id, 'payment.reject', 'order', o.id, jsonb_build_object('reason', trim(p_reason)));
  perform public.app_notify(o.user_id, 'payment_rejected', 'Comprovante não confirmado', trim(p_reason), jsonb_build_object('order_id', o.id));
  return jsonb_build_object('ok', true, 'code', 'rejected');
end;
$$;

-- Cancela pedido não pago: cartas voltam a ficar livres para outro evento.
create or replace function public.admin_cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('awaiting_shipping_quote', 'awaiting_payment', 'proof_sent') then
    return jsonb_build_object('ok', false, 'code', 'order_wrong_status');
  end if;
  if coalesce(length(trim(p_reason)), 0) not between 1 and 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  update public.payments set status = 'cancelled' where order_id = o.id and status in ('pending', 'proof_sent');
  update public.orders set status = 'cancelled', notes = trim(p_reason) where id = o.id;
  update public.wins set status = 'cancelled' where lot_id = o.lot_id and status in ('stored', 'in_order');
  perform public.app_audit(o.seller_id, 'order.cancel', 'order', o.id, jsonb_build_object('reason', trim(p_reason)));
  perform public.app_notify(o.user_id, 'order_cancelled', 'Pedido cancelado', trim(p_reason), jsonb_build_object('order_id', o.id));
  return jsonb_build_object('ok', true, 'code', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- Penalidades e desbloqueio: só o admin, sempre com justificativa.
-- ---------------------------------------------------------------------------
create or replace function public.admin_remove_penalty(p_penalty_id uuid, p_justification text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  p public.penalties;
begin
  select * into p from public.penalties where id = p_penalty_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'penalty_not_found'); end if;
  if not public.app_is_admin(p.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p.removed_at is not null then return jsonb_build_object('ok', false, 'code', 'penalty_already_removed'); end if;
  if coalesce(length(trim(p_justification)), 0) not between 5 and 500 then return jsonb_build_object('ok', false, 'code', 'justification_required'); end if;
  update public.penalties set removed_at = clock_timestamp(), removed_by = auth.uid(), removal_justification = trim(p_justification)
   where id = p.id;
  perform public.app_audit(p.seller_id, 'penalty.remove', 'penalty', p.id, jsonb_build_object('justification', trim(p_justification)));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

create or replace function public.admin_unblock_user(p_user_id uuid, p_justification text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := public.app_my_seller();
  v_profile public.profiles;
begin
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  -- só desbloqueia quem tem histórico com este leiloeiro
  if not found or not exists (select 1 from public.lots where user_id = p_user_id and seller_id = v_seller)
                    and not exists (select 1 from public.penalties where user_id = p_user_id and seller_id = v_seller) then
    return jsonb_build_object('ok', false, 'code', 'user_not_found');
  end if;
  if v_profile.status <> 'blocked' then return jsonb_build_object('ok', false, 'code', 'user_not_blocked'); end if;
  if coalesce(length(trim(p_justification)), 0) not between 5 and 500 then return jsonb_build_object('ok', false, 'code', 'justification_required'); end if;
  update public.profiles set status = 'active', blocked_at = null where id = p_user_id;
  perform public.app_audit(v_seller, 'user.unblock', 'profile', p_user_id, jsonb_build_object('justification', trim(p_justification)));
  perform public.app_notify(p_user_id, 'unblocked', 'Conta liberada', 'O leiloeiro liberou sua conta para lances.', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'unblocked');
end;
$$;

-- Lotes do usuário com prazo de pagamento (para a tela "Meu lote").
create or replace function public.my_lots()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', l.id,
      'status', l.status,
      'created_at', l.created_at,
      'seller_name', s.name,
      'first_event_number', l.first_event_number,
      'events_used', least(public.app_lot_progress(l), s.max_accumulation_events + 1),
      'max_events', s.max_accumulation_events,
      'must_close', public.app_lot_progress(l) >= s.max_accumulation_events,
      'due_at', public.app_lot_due_at(l),
      'order_id', (select o.id from public.orders o where o.lot_id = l.id),
      'total_cents', (select coalesce(sum(w.amount_cents), 0) from public.wins w where w.lot_id = l.id and w.status <> 'cancelled'),
      'wins', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', w.id, 'amount_cents', w.amount_cents, 'won_at', w.won_at, 'status', w.status,
                 'card_name', c.name, 'card_variant', c.variant, 'event_number', e.number,
                 'photo_path', (select p.storage_path from public.card_photos p where p.card_id = c.id order by p.position limit 1))
               order by w.won_at)
        from public.wins w
        join public.cards c on c.id = w.card_id
        join public.events e on e.id = w.event_id
        where w.lot_id = l.id
      ), '[]'::jsonb)
    ) as x
    from public.lots l
    join public.sellers s on s.id = l.seller_id
    where l.user_id = auth.uid()
  ) t;
$$;

-- Dados do Pix para quem tem pedido com o leiloeiro (a chave não é pública).
create or replace function public.order_pix(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('pix_key', s.pix_key, 'receiver_name', s.pix_receiver_name, 'receiver_city', s.pix_receiver_city)
    from public.orders o join public.sellers s on s.id = o.seller_id
   where o.id = p_order_id and (o.user_id = auth.uid() or public.app_is_admin(o.seller_id));
$$;

revoke execute on function public.app_lot_due_at(public.lots) from public, anon, authenticated;
-- a restrição de CPF roda com o papel de quem altera o perfil
grant execute on function public.app_valid_cpf(text) to anon, authenticated;
revoke execute on function public.app_norm_whatsapp(text) from public;
grant execute on function public.app_norm_whatsapp(text) to anon, authenticated;
revoke execute on function public.app_close_lot(uuid, text) from public, anon, authenticated;
revoke execute on function public.app_process_lots() from public, anon, authenticated;
revoke execute on function public.close_my_lot(uuid) from public, anon;
revoke execute on function public.admin_quote_shipping(uuid, bigint, text, int) from public, anon;
revoke execute on function public.submit_payment_proof(uuid, text) from public, anon;
revoke execute on function public.admin_confirm_payment(uuid) from public, anon;
revoke execute on function public.admin_reject_payment(uuid, text) from public, anon;
revoke execute on function public.admin_cancel_order(uuid, text) from public, anon;
revoke execute on function public.admin_remove_penalty(uuid, text) from public, anon;
revoke execute on function public.admin_unblock_user(uuid, text) from public, anon;
revoke execute on function public.order_pix(uuid) from public, anon;
grant execute on function public.close_my_lot(uuid) to authenticated;
grant execute on function public.admin_quote_shipping(uuid, bigint, text, int) to authenticated;
grant execute on function public.submit_payment_proof(uuid, text) to authenticated;
grant execute on function public.admin_confirm_payment(uuid) to authenticated;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated;
grant execute on function public.admin_cancel_order(uuid, text) to authenticated;
grant execute on function public.admin_remove_penalty(uuid, text) to authenticated;
grant execute on function public.admin_unblock_user(uuid, text) to authenticated;
grant execute on function public.order_pix(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Comprovantes: bucket privado. Caminho <user_id>/<order_id>/<arquivo>.
-- Comprador envia e vê os próprios; leiloeiro do pedido vê.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-proofs', 'payment-proofs', false, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;

    execute $p$
      create policy payment_proofs_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and exists (select 1 from public.orders o where o.id::text = (storage.foldername(name))[2] and o.user_id = (select auth.uid())))
    $p$;
    execute $p$
      create policy payment_proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'payment-proofs' and exists (
        select 1 from public.orders o where o.id::text = (storage.foldername(name))[2]
           and (o.user_id = (select auth.uid()) or public.app_is_admin(o.seller_id))))
    $p$;
  end if;
end $$;

-- Rotina de lotes e vencimentos a cada minuto (só no Supabase).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'process-lots';
    perform cron.schedule('process-lots', '* * * * *', 'select public.app_process_lots()');
  end if;
end $$;

-- CPF só muda pelo complete_profile (valida e impede trocar depois de informado).
revoke update (cpf) on public.profiles from authenticated;
