-- Carta entra na fila só pelo servidor: trava o evento e a carta e confere, na mesma
-- transação, que o evento ainda aceita cartas e que a carta não está em outra rodada
-- nem foi vendida. Carta que encerrou sem lances volta a ficar livre.

-- Rede de segurança: uma carta nunca está em duas rodadas vivas ao mesmo tempo.
create unique index if not exists rounds_one_live_per_card on public.rounds (card_id)
  where status in ('queued', 'open', 'paused');

create or replace function public.admin_add_round(
  p_event_id uuid,
  p_card_id uuid,
  p_mode public.auction_mode,
  p_start_price_cents bigint,
  p_increments_cents bigint[],
  p_bid_options_cents bigint[],
  p_fixed_price_cents bigint,
  p_close_mode public.close_mode,
  p_duration_seconds int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_card public.cards;
  v_position int;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_event.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_event.status in ('finished', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'event_already_finished'); end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found or v_card.seller_id <> v_event.seller_id then return jsonb_build_object('ok', false, 'code', 'card_not_found'); end if;
  if exists (select 1 from public.rounds where card_id = p_card_id and status in ('queued', 'open', 'paused'))
     or exists (select 1 from public.wins where card_id = p_card_id and status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'card_unavailable');
  end if;

  select coalesce(max(position), 0) + 1 into v_position from public.rounds where event_id = p_event_id;
  begin
    insert into public.rounds (seller_id, event_id, card_id, position, mode, start_price_cents, increments_cents,
                               bid_options_cents, fixed_price_cents, close_mode, duration_seconds)
    values (v_event.seller_id, p_event_id, p_card_id, v_position, p_mode, p_start_price_cents, p_increments_cents,
            p_bid_options_cents, p_fixed_price_cents, p_close_mode, p_duration_seconds)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  perform public.app_audit(v_event.seller_id, 'round.create', 'round', v_id);
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id);
end;
$$;

revoke execute on function public.admin_add_round(uuid, uuid, public.auction_mode, bigint, bigint[], bigint[], bigint, public.close_mode, int) from public, anon;
grant execute on function public.admin_add_round(uuid, uuid, public.auction_mode, bigint, bigint[], bigint[], bigint, public.close_mode, int) to authenticated;

-- A API não insere rodadas nem troca a carta de uma rodada direto; edição da configuração continua.
-- (a política rounds_admin_insert fica sem efeito, já que não há mais privilégio de insert)
revoke insert on public.rounds from anon, authenticated;
revoke update (card_id) on public.rounds from authenticated;
