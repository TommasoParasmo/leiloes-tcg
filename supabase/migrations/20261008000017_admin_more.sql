-- Painel do leiloeiro (lista de QA, itens 14, 17 e 18).
-- 14. Leiloeiro fecha o lote de um comprador e registra envio (rastreio) e entrega.
-- 17. WhatsApp: mensagem com erro volta para pendentes, mensagem pode ser
--     descartada, e rodada sem lances também gera mensagem (o leiloeiro decide publicar).
--     Envio automático com novas tentativas depende de integração oficial (não aprovada).
-- 18. Status e número do evento só mudam pelas funções (com checagem e auditoria).

-- ---------------------------------------------------------------------------
-- 14. Fechar lote pelo painel
-- ---------------------------------------------------------------------------
create or replace function public.admin_close_lot(p_lot_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_lot public.lots;
  v_order uuid;
begin
  select * into v_lot from public.lots where id = p_lot_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'lot_not_found'); end if;
  if not public.app_is_admin(v_lot.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_lot.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'lot_already_closed'); end if;
  -- o pedido guarda o endereço de entrega no fechamento: sem endereço não fecha
  if not exists (select 1 from public.addresses where user_id = v_lot.user_id) then
    return jsonb_build_object('ok', false, 'code', 'address_required');
  end if;
  v_order := public.app_close_lot(v_lot.id, 'admin');
  return jsonb_build_object('ok', true, 'code', 'lot_closed', 'order_id', v_order);
end;
$$;

-- Envio: pedido pago vira "enviado" com o código de rastreio; o comprador é avisado.
create or replace function public.admin_ship_order(p_order_id uuid, p_tracking_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
  v_code text := upper(regexp_replace(coalesce(p_tracking_code, ''), '\s', '', 'g'));
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('paid', 'shipped') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if length(v_code) not between 5 and 40 then return jsonb_build_object('ok', false, 'code', 'tracking_required'); end if;

  update public.orders set status = 'shipped' where id = o.id;
  update public.wins set status = 'shipped' where lot_id = o.lot_id and status = 'paid';
  insert into public.shipments (seller_id, order_id, tracking_code, status, posted_at)
  values (o.seller_id, o.id, v_code, 'posted', clock_timestamp())
  on conflict (order_id) do update set tracking_code = excluded.tracking_code, status = 'posted',
                                       posted_at = coalesce(public.shipments.posted_at, excluded.posted_at);
  perform public.app_audit(o.seller_id, 'order.ship', 'order', o.id, jsonb_build_object('tracking_code', v_code));
  perform public.app_notify(o.user_id, 'order_shipped', 'Seu pedido foi enviado',
    'Código de rastreio: ' || v_code, jsonb_build_object('order_id', o.id, 'tracking_code', v_code));
  return jsonb_build_object('ok', true, 'code', 'shipped');
end;
$$;

create or replace function public.admin_mark_delivered(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status <> 'shipped' then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  update public.orders set status = 'delivered' where id = o.id;
  update public.shipments set status = 'delivered' where order_id = o.id;
  perform public.app_audit(o.seller_id, 'order.deliver', 'order', o.id);
  return jsonb_build_object('ok', true, 'code', 'delivered');
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. WhatsApp
-- ---------------------------------------------------------------------------
-- Rodada encerrada sem lances também vai para a fila (a carta volta para outro evento).
create or replace function public.app_queue_unsold_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_card public.cards;
  v_event public.events;
  v_photo text;
begin
  if new.status = 'closed' and old.status is distinct from 'closed' and new.leading_bid_id is null then
    select * into v_card from public.cards where id = new.card_id;
    select * into v_event from public.events where id = new.event_id;
    select storage_path into v_photo from public.card_photos where card_id = new.card_id order by position limit 1;
    insert into public.whatsapp_messages (seller_id, kind, round_id, event_id, payload, status)
    values (
      new.seller_id, 'round_result', new.id, new.event_id,
      jsonb_build_object('card_name', v_card.name, 'card_variant', v_card.variant, 'amount_cents', null,
                         'winner_nickname', null, 'event_number', v_event.number, 'round_id', new.id, 'photo_path', v_photo),
      (select case when whatsapp_mode = 'automatic' then 'pending' else 'manual_pending' end::public.whatsapp_status
         from public.sellers where id = new.seller_id)
    )
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create or replace trigger rounds_queue_unsold_message
after update of status on public.rounds
for each row execute function public.app_queue_unsold_message();

-- Mensagem com erro volta para a fila; ou o leiloeiro descarta (não publica).
create or replace function public.admin_whatsapp_requeue(p_message_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.whatsapp_messages;
begin
  select * into m from public.whatsapp_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'message_not_found'); end if;
  if not public.app_is_admin(m.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if m.status <> 'failed' then return jsonb_build_object('ok', false, 'code', 'message_already_done'); end if;
  update public.whatsapp_messages
     set status = (select case when whatsapp_mode = 'automatic' then 'pending' else 'manual_pending' end::public.whatsapp_status
                     from public.sellers where id = m.seller_id),
         next_attempt_at = clock_timestamp()
   where id = m.id;
  perform public.app_audit(m.seller_id, 'whatsapp.requeue', 'whatsapp_message', m.id);
  return jsonb_build_object('ok', true, 'code', 'requeued');
end;
$$;

create or replace function public.admin_whatsapp_dismiss(p_message_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.whatsapp_messages;
begin
  select * into m from public.whatsapp_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'message_not_found'); end if;
  if not public.app_is_admin(m.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if m.status in ('sent', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'message_already_done'); end if;
  update public.whatsapp_messages set status = 'cancelled' where id = m.id;
  perform public.app_audit(m.seller_id, 'whatsapp.dismiss', 'whatsapp_message', m.id);
  return jsonb_build_object('ok', true, 'code', 'dismissed');
end;
$$;

revoke execute on function public.app_queue_unsold_message() from public, anon, authenticated;
revoke execute on function public.admin_close_lot(uuid) from public, anon;
revoke execute on function public.admin_ship_order(uuid, text) from public, anon;
revoke execute on function public.admin_mark_delivered(uuid) from public, anon;
revoke execute on function public.admin_whatsapp_requeue(uuid) from public, anon;
revoke execute on function public.admin_whatsapp_dismiss(uuid) from public, anon;
grant execute on function public.admin_close_lot(uuid) to authenticated;
grant execute on function public.admin_ship_order(uuid, text) to authenticated;
grant execute on function public.admin_mark_delivered(uuid) to authenticated;
grant execute on function public.admin_whatsapp_requeue(uuid) to authenticated;
grant execute on function public.admin_whatsapp_dismiss(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Eventos só mudam pelas funções (admin_create_event, admin_publish_event,
-- admin_finish_event...), que checam estado e gravam auditoria. A política
-- events_admin_write fica sem efeito sem o privilégio.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.events from anon, authenticated;
