-- Leilões TCG — motor de leilão.
-- Toda decisão de vencedor acontece aqui, dentro de transações com a linha da rodada
-- travada (SELECT ... FOR UPDATE). O relógio usado é sempre o do banco (clock_timestamp()).
-- As funções públicas devolvem jsonb {ok, code, ...}; o app traduz `code` para mensagens.

alter table public.rounds add column leading_user_id uuid references public.profiles (id);
alter table public.rounds add column leading_nickname text;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.app_is_admin(p_seller uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and admin_seller_id = p_seller and status = 'active'
  );
$$;

create or replace function public.app_brl(p_cents bigint)
returns text
language sql immutable set search_path = public
as $$
  select 'R$ ' || replace(to_char(p_cents / 100.0, 'FM999999990.00'), '.', ',');
$$;

create or replace function public.app_audit(p_seller uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_logs (seller_id, actor_id, action, entity, entity_id, details)
  values (p_seller, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.app_notify(p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb));
$$;

-- Quantos eventos (não cancelados) do leiloeiro um lote aberto já atravessou até p_event_number.
create or replace function public.app_lot_event_count(p_lot public.lots, p_event_number int)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.events e
  where e.seller_id = p_lot.seller_id
    and e.status <> 'cancelled'
    and e.number between p_lot.first_event_number and p_event_number;
$$;

-- Motivo pelo qual o usuário não pode lançar/arrematar nesta rodada, ou null se pode.
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

-- Estado público da rodada (o que a sala de leilão mostra).
create or replace function public.round_public_state(p_round_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'event_id', r.event_id,
    'card_id', r.card_id,
    'position', r.position,
    'mode', r.mode,
    'status', r.status,
    'start_price_cents', r.start_price_cents,
    'increments_cents', r.increments_cents,
    'bid_options_cents', r.bid_options_cents,
    'fixed_price_cents', r.fixed_price_cents,
    'close_mode', r.close_mode,
    'duration_seconds', r.duration_seconds,
    'opened_at', r.opened_at,
    'ends_at', r.ends_at,
    'paused_remaining_ms', r.paused_remaining_ms,
    'closed_at', r.closed_at,
    'current_amount_cents', r.current_amount_cents,
    'leading_nickname', r.leading_nickname,
    'leading_is_me', (r.leading_user_id is not null and r.leading_user_id = auth.uid()),
    'bid_count', r.bid_count,
    'server_now', clock_timestamp(),
    'recent_bids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', b.seq, 'nickname', p.nickname, 'amount_cents', b.amount_cents,
               'created_at', b.created_at, 'is_me', b.user_id = auth.uid())
             order by b.seq desc)
      from (select * from public.bids where round_id = r.id order by seq desc limit 5) b
      join public.profiles p on p.id = b.user_id
    ), '[]'::jsonb)
  )
  from public.rounds r where r.id = p_round_id;
$$;

-- ---------------------------------------------------------------------------
-- Encerramento (interno). Exige a linha da rodada já travada pelo chamador.
-- Confirma o vencedor, vincula ao lote do comprador e enfileira a publicação
-- no WhatsApp. Nenhuma chamada externa acontece aqui: o envio ao WhatsApp é
-- feito por um worker que lê a fila, então nunca atrasa o encerramento.
-- ---------------------------------------------------------------------------
create or replace function public.app_finalize_round(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
  v_bid public.bids;
  v_lot public.lots;
  v_event public.events;
  v_card public.cards;
  v_win_id uuid;
  v_photo text;
begin
  select * into r from public.rounds where id = p_round_id;  -- já travada pelo chamador
  if r.status not in ('open', 'paused') then
    return jsonb_build_object('ok', false, 'code', 'round_not_open');
  end if;

  update public.rounds
     set status = 'closed', closed_at = clock_timestamp(), paused_remaining_ms = null
   where id = r.id;

  if r.leading_bid_id is null then
    return jsonb_build_object('ok', true, 'code', 'closed_without_winner');
  end if;

  select * into v_bid from public.bids where id = r.leading_bid_id;
  select * into v_event from public.events where id = r.event_id;
  select * into v_card from public.cards where id = r.card_id;

  -- lote de acumulação: usa o aberto ou abre um novo começando neste evento
  select * into v_lot from public.lots
   where seller_id = r.seller_id and user_id = v_bid.user_id and status = 'open'
   for update;
  if not found then
    insert into public.lots (seller_id, user_id, first_event_id, first_event_number)
    values (r.seller_id, v_bid.user_id, v_event.id, v_event.number)
    returning * into v_lot;
  end if;

  insert into public.wins (seller_id, round_id, bid_id, user_id, event_id, card_id, lot_id, amount_cents)
  values (r.seller_id, r.id, v_bid.id, v_bid.user_id, r.event_id, r.card_id, v_lot.id, v_bid.amount_cents)
  returning id into v_win_id;

  select storage_path into v_photo from public.card_photos
   where card_id = r.card_id order by position limit 1;

  insert into public.whatsapp_messages (seller_id, kind, round_id, event_id, payload, status)
  values (
    r.seller_id, 'round_result', r.id, r.event_id,
    jsonb_build_object(
      'card_name', v_card.name,
      'card_variant', v_card.variant,
      'amount_cents', v_bid.amount_cents,
      'winner_nickname', r.leading_nickname,
      'event_number', v_event.number,
      'round_id', r.id,
      'photo_path', v_photo
    ),
    (select case when whatsapp_mode = 'automatic' then 'pending' else 'manual_pending' end::public.whatsapp_status
       from public.sellers where id = r.seller_id)
  )
  on conflict do nothing;

  perform public.app_notify(
    v_bid.user_id, 'round_won', 'Você arrematou ' || v_card.name,
    'Valor: ' || public.app_brl(v_bid.amount_cents) || ' · Leilão #' || v_event.number,
    jsonb_build_object('round_id', r.id, 'win_id', v_win_id, 'amount_cents', v_bid.amount_cents)
  );

  return jsonb_build_object('ok', true, 'code', 'closed_with_winner', 'win_id', v_win_id,
                            'winner_nickname', r.leading_nickname, 'amount_cents', v_bid.amount_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- Modo A — maior lance
-- ---------------------------------------------------------------------------
create or replace function public.place_bid(p_round_id uuid, p_amount_cents bigint, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rounds;
  v_existing public.bids;
  v_block text;
  v_now timestamptz;
  v_min bigint;
  v_max bigint;
  v_base bigint;
  v_bid public.bids;
  v_nickname text;
  v_prev_leader uuid;
  v_leads boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- requisição repetida (toque duplo, reenvio após reconexão): devolve o mesmo resultado
  select * into v_existing from public.bids where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'bid_id', v_existing.id,
                              'state', public.round_public_state(v_existing.round_id));
  end if;

  select * into r from public.rounds where id = p_round_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;
  -- a mesma chave pode ter sido gravada por uma requisição paralela enquanto esperávamos a trava
  select * into v_existing from public.bids where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'bid_id', v_existing.id,
                              'state', public.round_public_state(v_existing.round_id));
  end if;
  if r.mode <> 'highest_bid' then
    return jsonb_build_object('ok', false, 'code', 'wrong_mode');
  end if;

  v_now := clock_timestamp();
  if r.status = 'open' and r.close_mode = 'timer' and v_now >= r.ends_at then
    perform public.app_finalize_round(r.id);
    return jsonb_build_object('ok', false, 'code', 'round_closed', 'state', public.round_public_state(r.id));
  end if;
  if r.status = 'paused' then
    return jsonb_build_object('ok', false, 'code', 'round_paused');
  end if;
  if r.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'round_closed', 'state', public.round_public_state(r.id));
  end if;

  v_block := public.app_participation_block(v_uid, r);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'code', v_block);
  end if;

  if r.leading_user_id = v_uid then
    return jsonb_build_object('ok', false, 'code', 'already_leading', 'state', public.round_public_state(r.id));
  end if;

  if r.bid_options_cents is not null then
    -- opções fixas (como as votações do WhatsApp): o valor precisa ser uma das opções e
    -- não pode ser menor que o lance atual. Valor igual é aceito e registrado, mas
    -- quem lançou primeiro continua liderando (desempate pela ordem no servidor).
    if not (p_amount_cents = any (r.bid_options_cents)) then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'state', public.round_public_state(r.id));
    end if;
    if r.current_amount_cents is not null and p_amount_cents < r.current_amount_cents then
      return jsonb_build_object('ok', false, 'code', 'amount_too_low', 'min_cents', r.current_amount_cents,
                                'state', public.round_public_state(r.id));
    end if;
  else
    -- incrementos: o primeiro lance vai do lance inicial até lance inicial + maior incremento;
    -- depois, precisa superar o atual em no máximo o maior incremento (evita erro de digitação).
    select max(x) into v_max from unnest(r.increments_cents) x;
    if r.current_amount_cents is null then
      v_min := r.start_price_cents;
      v_base := r.start_price_cents;
    else
      select r.current_amount_cents + min(x) into v_min from unnest(r.increments_cents) x;
      v_base := r.current_amount_cents;
    end if;
    if p_amount_cents < v_min then
      return jsonb_build_object('ok', false, 'code', 'amount_too_low', 'min_cents', v_min,
                                'state', public.round_public_state(r.id));
    end if;
    if p_amount_cents > v_base + v_max then
      return jsonb_build_object('ok', false, 'code', 'amount_too_high', 'max_cents', v_base + v_max,
                                'state', public.round_public_state(r.id));
    end if;
  end if;

  begin
    insert into public.bids (round_id, user_id, amount_cents, idempotency_key)
    values (r.id, v_uid, p_amount_cents, p_idempotency_key)
    returning * into v_bid;
  exception when unique_violation then
    -- mesma chave chegando em paralelo: a outra requisição já registrou o lance
    select * into v_existing from public.bids where user_id = v_uid and idempotency_key = p_idempotency_key;
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'bid_id', v_existing.id,
                              'state', public.round_public_state(r.id));
  end;

  v_leads := r.current_amount_cents is null or p_amount_cents > r.current_amount_cents;
  v_prev_leader := r.leading_user_id;

  if v_leads then
    select nickname into v_nickname from public.profiles where id = v_uid;
    update public.rounds
       set leading_bid_id = v_bid.id, leading_user_id = v_uid, leading_nickname = v_nickname,
           current_amount_cents = p_amount_cents, bid_count = bid_count + 1
     where id = r.id;
    if v_prev_leader is not null then
      perform public.app_notify(v_prev_leader, 'outbid', 'Seu lance foi superado',
        v_nickname || ' ofereceu ' || public.app_brl(p_amount_cents),
        jsonb_build_object('round_id', r.id, 'amount_cents', p_amount_cents, 'nickname', v_nickname));
    end if;
  else
    update public.rounds set bid_count = bid_count + 1 where id = r.id;
  end if;

  return jsonb_build_object('ok', true, 'code', case when v_leads then 'leading' else 'tie_not_leading' end,
                            'bid_id', v_bid.id, 'seq', v_bid.seq, 'created_at', v_bid.created_at,
                            'state', public.round_public_state(r.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Modo B — rapidez (primeiro a arrematar vence)
-- ---------------------------------------------------------------------------
create or replace function public.buy_now(p_round_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rounds;
  v_existing public.bids;
  v_block text;
  v_bid public.bids;
  v_nickname text;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_existing from public.bids where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'bid_id', v_existing.id,
                              'state', public.round_public_state(v_existing.round_id));
  end if;

  -- a trava serializa todos os toques: só o primeiro encontra a rodada aberta
  select * into r from public.rounds where id = p_round_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;
  -- a mesma chave pode ter sido gravada por uma requisição paralela enquanto esperávamos a trava
  select * into v_existing from public.bids where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'bid_id', v_existing.id,
                              'state', public.round_public_state(v_existing.round_id));
  end if;
  if r.mode <> 'speed' then
    return jsonb_build_object('ok', false, 'code', 'wrong_mode');
  end if;
  if r.status = 'closed' and r.leading_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_sold', 'state', public.round_public_state(r.id));
  end if;
  if r.status = 'paused' then
    return jsonb_build_object('ok', false, 'code', 'round_paused');
  end if;
  if r.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', case when r.status = 'queued' then 'round_not_started' else 'round_closed' end,
                              'state', public.round_public_state(r.id));
  end if;

  v_block := public.app_participation_block(v_uid, r);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'code', v_block);
  end if;

  insert into public.bids (round_id, user_id, amount_cents, idempotency_key)
  values (r.id, v_uid, r.fixed_price_cents, p_idempotency_key)
  returning * into v_bid;

  select nickname into v_nickname from public.profiles where id = v_uid;
  update public.rounds
     set leading_bid_id = v_bid.id, leading_user_id = v_uid, leading_nickname = v_nickname,
         current_amount_cents = r.fixed_price_cents, bid_count = bid_count + 1
   where id = r.id;

  v_result := public.app_finalize_round(r.id);

  return jsonb_build_object('ok', true, 'code', 'won', 'bid_id', v_bid.id, 'seq', v_bid.seq,
                            'created_at', v_bid.created_at, 'win_id', v_result -> 'win_id',
                            'state', public.round_public_state(r.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Controles do leiloeiro
-- ---------------------------------------------------------------------------
create or replace function public.admin_open_round(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
  v_now timestamptz := clock_timestamp();
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;
  if not public.app_is_admin(r.seller_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if r.status <> 'queued' then
    return jsonb_build_object('ok', false, 'code', 'round_not_queued');
  end if;
  if exists (select 1 from public.rounds where event_id = r.event_id and status in ('open', 'paused')) then
    return jsonb_build_object('ok', false, 'code', 'another_round_active');
  end if;

  update public.events
     set status = 'live', started_at = coalesce(started_at, v_now)
   where id = r.event_id and status in ('draft', 'scheduled');
  if exists (select 1 from public.events where id = r.event_id and status <> 'live') then
    return jsonb_build_object('ok', false, 'code', 'event_not_live');
  end if;

  update public.rounds
     set status = 'open', opened_at = v_now,
         ends_at = case when close_mode = 'timer' and mode = 'highest_bid'
                        then v_now + make_interval(secs => duration_seconds) end
   where id = r.id;

  perform public.app_audit(r.seller_id, 'round.open', 'round', r.id);
  return jsonb_build_object('ok', true, 'code', 'opened', 'state', public.round_public_state(r.id));
end;
$$;

create or replace function public.admin_pause_round(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
  v_now timestamptz := clock_timestamp();
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if not public.app_is_admin(r.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if r.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'round_not_open'); end if;
  if r.ends_at is not null and v_now >= r.ends_at then
    perform public.app_finalize_round(r.id);
    return jsonb_build_object('ok', false, 'code', 'round_closed', 'state', public.round_public_state(r.id));
  end if;

  update public.rounds
     set status = 'paused',
         paused_remaining_ms = case when ends_at is not null
                                    then floor(extract(epoch from (ends_at - v_now)) * 1000)::bigint end,
         ends_at = null
   where id = r.id;
  perform public.app_audit(r.seller_id, 'round.pause', 'round', r.id);
  return jsonb_build_object('ok', true, 'code', 'paused', 'state', public.round_public_state(r.id));
end;
$$;

create or replace function public.admin_resume_round(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if not public.app_is_admin(r.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if r.status <> 'paused' then return jsonb_build_object('ok', false, 'code', 'round_not_paused'); end if;

  update public.rounds
     set status = 'open',
         ends_at = case when paused_remaining_ms is not null
                        then clock_timestamp() + make_interval(secs => paused_remaining_ms / 1000.0) end,
         paused_remaining_ms = null
   where id = r.id;
  perform public.app_audit(r.seller_id, 'round.resume', 'round', r.id);
  return jsonb_build_object('ok', true, 'code', 'resumed', 'state', public.round_public_state(r.id));
end;
$$;

create or replace function public.admin_extend_round(p_round_id uuid, p_seconds int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
begin
  if p_seconds is null or p_seconds not between 1 and 600 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if not public.app_is_admin(r.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if r.status = 'open' and r.ends_at is not null and clock_timestamp() < r.ends_at then
    update public.rounds set ends_at = ends_at + make_interval(secs => p_seconds) where id = r.id;
  elsif r.status = 'paused' and r.paused_remaining_ms is not null then
    update public.rounds set paused_remaining_ms = paused_remaining_ms + p_seconds * 1000 where id = r.id;
  else
    return jsonb_build_object('ok', false, 'code', 'round_has_no_timer');
  end if;
  perform public.app_audit(r.seller_id, 'round.extend', 'round', r.id, jsonb_build_object('seconds', p_seconds));
  return jsonb_build_object('ok', true, 'code', 'extended', 'state', public.round_public_state(r.id));
end;
$$;

create or replace function public.admin_close_round(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
  v_result jsonb;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if not public.app_is_admin(r.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  v_result := public.app_finalize_round(r.id);
  if (v_result ->> 'ok')::boolean then
    perform public.app_audit(r.seller_id, 'round.close', 'round', r.id, v_result);
  end if;
  return v_result || jsonb_build_object('state', public.round_public_state(r.id));
end;
$$;

create or replace function public.admin_cancel_round(p_round_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if not public.app_is_admin(r.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if r.status not in ('queued', 'open', 'paused') then
    return jsonb_build_object('ok', false, 'code', 'round_not_cancellable');
  end if;
  update public.rounds
     set status = 'cancelled', closed_at = clock_timestamp(), cancel_reason = p_reason
   where id = r.id;
  perform public.app_audit(r.seller_id, 'round.cancel', 'round', r.id, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'code', 'cancelled', 'state', public.round_public_state(r.id));
end;
$$;

-- Chamado por agendador (pg_cron / cron da Vercel) a cada poucos segundos.
-- Também acontece sob demanda no primeiro lance após o fim do cronômetro.
create or replace function public.close_expired_rounds()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.rounds
     where status = 'open' and close_mode = 'timer' and ends_at <= clock_timestamp()
     for update skip locked
  loop
    perform public.app_finalize_round(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões das funções: só usuários autenticados chamam lance/arremate/admin;
-- funções internas (app_*) não ficam expostas pela API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.round_public_state(uuid) to anon, authenticated;
grant execute on function public.place_bid(uuid, bigint, text) to authenticated;
grant execute on function public.buy_now(uuid, text) to authenticated;
grant execute on function public.admin_open_round(uuid) to authenticated;
grant execute on function public.admin_pause_round(uuid) to authenticated;
grant execute on function public.admin_resume_round(uuid) to authenticated;
grant execute on function public.admin_extend_round(uuid, int) to authenticated;
grant execute on function public.admin_close_round(uuid) to authenticated;
grant execute on function public.admin_cancel_round(uuid, text) to authenticated;
grant execute on function public.app_is_admin(uuid) to authenticated;
