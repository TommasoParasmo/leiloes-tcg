-- Rapidez com opções (pedido do Tom): até 4 valores fixos, ex.: 10, 11, 12, 13. Quem tocar
-- primeiro no maior valor arremata na hora; se ninguém chegar nele, vale o maior lance
-- quando o tempo acabar (ou quando o leiloeiro encerrar).
-- Fica no modo highest_bid com bid_options_cents e fixed_price_cents = o maior valor, que
-- passa a significar "arremata na hora". Sem fixed_price, as opções fixas seguem como antes.

create or replace function public.app_max_cents(v bigint[]) returns bigint
language sql immutable set search_path = public as $$ select max(x) from unnest(v) x $$;

alter table public.rounds drop constraint if exists instant_price_needs_options;
alter table public.rounds add constraint instant_price_needs_options check (
  mode = 'speed' or fixed_price_cents is null
  or (bid_options_cents is not null and fixed_price_cents = public.app_max_cents(bid_options_cents))
);

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

  -- rapidez com opções: quem chega primeiro ao valor de arremate leva na hora
  if v_leads and r.fixed_price_cents is not null and p_amount_cents >= r.fixed_price_cents then
    perform public.app_finalize_round(r.id);
    return jsonb_build_object('ok', true, 'code', 'won', 'bid_id', v_bid.id, 'seq', v_bid.seq,
                              'created_at', v_bid.created_at, 'state', public.round_public_state(r.id));
  end if;

  return jsonb_build_object('ok', true, 'code', case when v_leads then 'leading' else 'tie_not_leading' end,
                            'bid_id', v_bid.id, 'seq', v_bid.seq, 'created_at', v_bid.created_at,
                            'state', public.round_public_state(r.id));
end;
$$;
