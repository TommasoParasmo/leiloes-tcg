-- Sala ao vivo (lista de QA, itens 6, 7, 10 e 13).
--  6. Opções fixas: no máximo um lance por valor por pessoa (empate repetido travava a rodada).
--  7. Incrementos: só os passos configurados (+3,47 enviado direto à API não passa).
-- 10. Estado da sala traz o status do evento, para mostrar "Evento encerrado".
-- 13. Cada mudança na rodada é transmitida pronta pelo canal da sala (realtime.send), em vez
--     de cada espectador reler o estado a cada lance. A leitura pessoal (minha liderança,
--     meu bloqueio) só acontece ao entrar, ao trocar de carta e ao dar lance.
-- (26, esconder o id do líder, fica na migração seguinte: o site no ar ainda usa rounds(count).)

-- ---------------------------------------------------------------------------
-- Versão da rodada: sobe a cada mudança. A sala descarta estado com versão menor,
-- então um aviso atrasado do tempo real nunca volta a tela para trás.
-- ---------------------------------------------------------------------------
alter table public.rounds add column if not exists rev bigint not null default 0;

create or replace function public.app_bump_round_rev()
returns trigger
language plpgsql
as $$
begin
  new.rev := old.rev + 1;
  return new;
end;
$$;

create or replace trigger rounds_bump_rev
before update on public.rounds
for each row execute function public.app_bump_round_rev();

-- ---------------------------------------------------------------------------
-- Estado da rodada para um espectador (p_viewer null = visitante / transmissão pública).
-- ---------------------------------------------------------------------------
create or replace function public.app_round_state(p_round_id uuid, p_viewer uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'rev', r.rev,
    'event_id', r.event_id,
    'event_status', e.status,
    'card_id', r.card_id,
    'position', r.position,
    -- "7/22" na sala: ordem da carta dentro do evento (posições podem ter lacunas)
    'ordinal', (select count(*) from public.rounds o where o.event_id = r.event_id and o.position <= r.position),
    'round_total', (select count(*) from public.rounds o where o.event_id = r.event_id),
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
    'leading_is_me', (p_viewer is not null and r.leading_user_id is not distinct from p_viewer),
    'my_nickname', (select nickname from public.profiles where id = p_viewer),
    'my_best_bid_cents', (select max(amount_cents) from public.bids where round_id = r.id and user_id = p_viewer),
    -- motivo pelo qual o visitante/usuário não pode participar (null = pode)
    'my_block', case when p_viewer is null then 'not_authenticated'
                     else public.app_participation_block(p_viewer, r) end,
    'bid_count', r.bid_count,
    'server_now', clock_timestamp(),
    'recent_bids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', b.seq, 'nickname', p.nickname, 'amount_cents', b.amount_cents,
               'created_at', b.created_at, 'is_me', p_viewer is not null and b.user_id = p_viewer)
             order by b.seq desc)
      from (select * from public.bids where round_id = r.id order by seq desc limit 5) b
      join public.profiles p on p.id = b.user_id
    ), '[]'::jsonb)
  )
  from public.rounds r join public.events e on e.id = r.event_id
  where r.id = p_round_id;
$$;

create or replace function public.round_public_state(p_round_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.app_round_state(p_round_id, auth.uid());
$$;

-- Uma leitura só para a sala: escolhe a rodada (aberta/pausada; senão a última encerrada;
-- senão a próxima da fila) e devolve o estado pessoal dela com o status do evento.
create or replace function public.room_state(p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_status public.event_status;
  v_round uuid;
begin
  select status into v_status from public.events where id = p_event_id and status <> 'draft';
  if not found then
    -- rascunho só aparece para o leiloeiro (pré-visualização)
    select status into v_status from public.events where id = p_event_id and public.app_is_admin(seller_id);
    if not found then return null; end if;
  end if;
  select id into v_round from public.rounds
   where event_id = p_event_id
   order by (status in ('open', 'paused')) desc, closed_at desc nulls last, position
   limit 1;
  return jsonb_build_object('event_status', v_status,
                            'state', case when v_round is null then null else public.app_round_state(v_round, auth.uid()) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Transmissão pela sala: tópico público "sala:<evento>". Só dados públicos.
-- Falha no tempo real nunca desfaz um lance: o erro é engolido e a sala relê sozinha.
-- ---------------------------------------------------------------------------
create or replace function public.app_broadcast_round()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(public.app_round_state(new.id, null), 'round', 'sala:' || new.event_id, false);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create or replace trigger rounds_broadcast
after insert or update on public.rounds
for each row execute function public.app_broadcast_round();

create or replace function public.app_broadcast_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(jsonb_build_object('event_status', new.status), 'event', 'sala:' || new.id, false);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create or replace trigger events_broadcast
after update of status on public.events
for each row execute function public.app_broadcast_event();

-- ---------------------------------------------------------------------------
-- Lance (modo maior lance), com as regras 6 e 7.
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
  v_allowed bigint[];
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
    -- não pode ser menor que o lance atual. Valor igual é aceito e registrado (quem lançou
    -- primeiro continua liderando), mas cada pessoa lança cada valor uma vez só.
    if not (p_amount_cents = any (r.bid_options_cents)) then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'state', public.round_public_state(r.id));
    end if;
    if r.current_amount_cents is not null and p_amount_cents < r.current_amount_cents then
      return jsonb_build_object('ok', false, 'code', 'amount_too_low', 'min_cents', r.current_amount_cents,
                                'state', public.round_public_state(r.id));
    end if;
    if exists (select 1 from public.bids where round_id = r.id and user_id = v_uid and amount_cents = p_amount_cents) then
      return jsonb_build_object('ok', false, 'code', 'amount_already_bid', 'state', public.round_public_state(r.id));
    end if;
  else
    -- incrementos: o primeiro lance é o lance inicial ou o inicial + um dos passos;
    -- depois, o lance atual + um dos passos. Nenhum outro valor passa.
    if r.current_amount_cents is null then
      v_min := r.start_price_cents;
      v_allowed := array[r.start_price_cents] || (select array_agg(r.start_price_cents + x) from unnest(r.increments_cents) x);
    else
      select r.current_amount_cents + min(x) into v_min from unnest(r.increments_cents) x;
      v_allowed := (select array_agg(r.current_amount_cents + x) from unnest(r.increments_cents) x);
    end if;
    if p_amount_cents < v_min then
      return jsonb_build_object('ok', false, 'code', 'amount_too_low', 'min_cents', v_min,
                                'state', public.round_public_state(r.id));
    end if;
    if p_amount_cents > (select max(x) from unnest(v_allowed) x) then
      return jsonb_build_object('ok', false, 'code', 'amount_too_high', 'max_cents', (select max(x) from unnest(v_allowed) x),
                                'state', public.round_public_state(r.id));
    end if;
    if not (p_amount_cents = any (v_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'state', public.round_public_state(r.id));
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

revoke execute on function public.app_round_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.app_bump_round_rev() from public, anon, authenticated;
revoke execute on function public.app_broadcast_round() from public, anon, authenticated;
revoke execute on function public.app_broadcast_event() from public, anon, authenticated;
grant execute on function public.room_state(uuid) to anon, authenticated;
