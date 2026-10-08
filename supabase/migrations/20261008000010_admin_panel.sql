-- Painel do leiloeiro: criar evento, ordenar a fila, liberar a próxima carta,
-- encerrar o evento, publicar no WhatsApp e fechar rodadas cujo cronômetro acabou.
-- Tudo passa por funções que conferem se quem chama é admin do leiloeiro dono.

-- Seller do admin logado (null para quem não é admin ativo).
create or replace function public.app_my_seller()
returns uuid
language sql stable security definer set search_path = public
as $$
  select admin_seller_id from public.profiles
   where id = auth.uid() and role = 'admin' and status = 'active';
$$;

-- Cria evento com o próximo número sequencial do leiloeiro ("Leilão #16").
create or replace function public.admin_create_event(p_title text, p_starts_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := public.app_my_seller();
  v_id uuid;
  v_number int;
begin
  if v_seller is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if coalesce(length(trim(p_title)), 0) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  -- trava o leiloeiro para dois cadastros simultâneos não pegarem o mesmo número
  perform 1 from public.sellers where id = v_seller for update;
  select coalesce(max(number), 0) + 1 into v_number from public.events where seller_id = v_seller;
  insert into public.events (seller_id, number, title, starts_at, status)
  values (v_seller, v_number, trim(p_title), p_starts_at, 'scheduled')
  returning id into v_id;
  perform public.app_audit(v_seller, 'event.create', 'event', v_id);
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id, 'number', v_number);
end;
$$;

-- Reordena as rodadas ainda na fila. p_round_ids = todas as rodadas 'queued' do evento,
-- na nova ordem; elas vão depois das rodadas que já abriram.
create or replace function public.admin_reorder_queue(p_event_id uuid, p_round_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_base int;
  v_queued uuid[];
  i int;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_event.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;

  select array_agg(id order by position) into v_queued
    from public.rounds where event_id = p_event_id and status = 'queued';
  if p_round_ids is null or cardinality(p_round_ids) <> coalesce(cardinality(v_queued), 0)
     or exists (select 1 from unnest(p_round_ids) x where x <> all (v_queued))
     or (select count(distinct x) from unnest(p_round_ids) x) <> cardinality(p_round_ids) then
    return jsonb_build_object('ok', false, 'code', 'queue_changed');
  end if;

  select coalesce(max(position), 0) into v_base
    from public.rounds where event_id = p_event_id and status <> 'queued';
  for i in 1 .. cardinality(p_round_ids) loop
    -- (event_id, position) é único com checagem adiada: trocas valem no fim da transação
    update public.rounds set position = v_base + i where id = p_round_ids[i];
  end loop;
  perform public.app_audit(v_event.seller_id, 'event.reorder', 'event', p_event_id);
  return jsonb_build_object('ok', true, 'code', 'reordered');
end;
$$;

-- Libera a próxima carta da fila (menor posição ainda 'queued').
create or replace function public.admin_open_next_round(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid;
  v_next uuid;
begin
  select seller_id into v_seller from public.events where id = p_event_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_seller) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  select id into v_next from public.rounds
   where event_id = p_event_id and status = 'queued' order by position limit 1;
  if v_next is null then return jsonb_build_object('ok', false, 'code', 'queue_empty'); end if;
  return public.admin_open_round(v_next);
end;
$$;

-- Encerra o evento. Exige nenhuma rodada ativa; cartas que ficaram na fila são
-- canceladas (voltam a ficar livres para outro evento).
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
  return jsonb_build_object('ok', true, 'code', 'finished', 'unsold', v_left);
end;
$$;

-- Leiloeiro confirma que publicou (ou que falhou) a mensagem no grupo.
create or replace function public.admin_whatsapp_mark(p_message_id uuid, p_sent boolean, p_error text default null)
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
  update public.whatsapp_messages
     set status = case when p_sent then 'sent' else 'failed' end::public.whatsapp_status,
         sent_at = case when p_sent then clock_timestamp() end,
         confirmed_by = auth.uid(),
         attempts = attempts + 1,
         last_error = case when p_sent then null else left(coalesce(p_error, 'Marcado como erro pelo leiloeiro'), 300) end
   where id = m.id;
  perform public.app_audit(m.seller_id, case when p_sent then 'whatsapp.sent' else 'whatsapp.failed' end, 'whatsapp_message', m.id);
  return jsonb_build_object('ok', true, 'code', case when p_sent then 'sent' else 'failed' end);
end;
$$;

-- Fecha uma rodada cujo cronômetro já acabou. Qualquer um pode pedir (a sala pede quando
-- o relógio zera): o servidor só fecha se o horário dele confirmar o fim.
create or replace function public.close_round_if_expired(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'round_not_found'); end if;
  if r.status = 'open' and r.close_mode = 'timer' and r.ends_at <= clock_timestamp() then
    perform public.app_finalize_round(r.id);
    return jsonb_build_object('ok', true, 'code', 'closed', 'state', public.round_public_state(r.id));
  end if;
  return jsonb_build_object('ok', false, 'code', 'not_expired', 'state', public.round_public_state(r.id));
end;
$$;

revoke execute on function public.app_my_seller() from public, anon, authenticated;
revoke execute on function public.admin_create_event(text, timestamptz) from public, anon;
revoke execute on function public.admin_reorder_queue(uuid, uuid[]) from public, anon;
revoke execute on function public.admin_open_next_round(uuid) from public, anon;
revoke execute on function public.admin_finish_event(uuid) from public, anon;
revoke execute on function public.admin_whatsapp_mark(uuid, boolean, text) from public, anon;
revoke execute on function public.close_round_if_expired(uuid) from public;
grant execute on function public.admin_create_event(text, timestamptz) to authenticated;
grant execute on function public.admin_reorder_queue(uuid, uuid[]) to authenticated;
grant execute on function public.admin_open_next_round(uuid) to authenticated;
grant execute on function public.admin_finish_event(uuid) to authenticated;
grant execute on function public.admin_whatsapp_mark(uuid, boolean, text) to authenticated;
grant execute on function public.close_round_if_expired(uuid) to anon, authenticated;

-- Reserva para quando ninguém está com a sala aberta: fecha rodadas vencidas a cada 5 s.
-- Só existe no Supabase (pg_cron); nos testes locais o bloco não faz nada.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'close-expired-rounds';
    perform cron.schedule('close-expired-rounds', '5 seconds', 'select public.close_expired_rounds()');
  end if;
end $$;
