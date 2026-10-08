-- Sala ao vivo: o estado público passa a dizer o maior lance do próprio usuário,
-- para a interface mostrar "superado" mesmo quando o lance saiu dos 5 mais recentes,
-- e o motivo de bloqueio, para trocar os botões pelo aviso antes do primeiro toque.

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
    'my_best_bid_cents', (select max(amount_cents) from public.bids where round_id = r.id and user_id = auth.uid()),
    -- motivo pelo qual o visitante/usuário não pode participar (null = pode)
    'my_block', case when auth.uid() is null then 'not_authenticated'
                     else public.app_participation_block(auth.uid(), r) end,
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
