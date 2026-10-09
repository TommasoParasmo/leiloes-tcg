-- Intervalo do leilão (pedido do Tom: "uma pausa de até 10 minutos que o leiloeiro pode fazer").
-- O leiloeiro escolhe de 1 a 10 minutos; a carta que estiver aberta congela o cronômetro e
-- ninguém dá lance. Acaba quando ele toca em "Voltar agora", quando abre ou retoma uma
-- carta, ou sozinho quando o tempo termina (o agendador de 5 s já roda close_expired_rounds).

alter table public.events
  add column break_until timestamptz,
  -- sem chave estrangeira: uma segunda ligação events↔rounds deixaria ambíguas as consultas com rounds(...) da API
  add column break_round_id uuid;

-- termina o intervalo: retoma a carta que ele pausou (se ainda estiver pausada) e limpa o aviso
create or replace function public.app_end_break(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found or e.break_until is null then return; end if;
  update public.events set break_until = null, break_round_id = null where id = e.id;
  if e.break_round_id is not null then
    update public.rounds
       set status = 'open',
           ends_at = case when paused_remaining_ms is not null
                          then clock_timestamp() + make_interval(secs => paused_remaining_ms / 1000.0) end,
           paused_remaining_ms = null
     where id = e.break_round_id and status = 'paused';
  end if;
end;
$$;

create or replace function public.admin_start_break(p_event_id uuid, p_minutes int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
  v_round uuid;
  v_paused uuid;
  v_res jsonb;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(e.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if e.status <> 'live' then return jsonb_build_object('ok', false, 'code', 'event_not_live'); end if;
  if p_minutes is null or p_minutes not between 1 and 10 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if e.break_until is not null then return jsonb_build_object('ok', false, 'code', 'break_active'); end if;

  -- a carta aberta congela (se o tempo dela já tinha acabado, ela fecha normalmente)
  select id into v_round from public.rounds where event_id = e.id and status = 'open' limit 1;
  if v_round is not null then
    v_res := public.admin_pause_round(v_round);
    if (v_res ->> 'code') = 'paused' then v_paused := v_round; end if;
  end if;

  update public.events
     set break_until = clock_timestamp() + make_interval(mins => p_minutes),
         break_round_id = v_paused
   where id = e.id;
  perform public.app_audit(e.seller_id, 'event.break', 'event', e.id, jsonb_build_object('minutes', p_minutes, 'round_id', v_paused));
  return jsonb_build_object('ok', true, 'code', 'break_started',
                            'break_until', (select break_until from public.events where id = e.id));
end;
$$;

create or replace function public.admin_end_break(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(e.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if e.break_until is null then return jsonb_build_object('ok', true, 'code', 'break_ended'); end if;
  perform public.app_end_break(e.id);
  perform public.app_audit(e.seller_id, 'event.break_end', 'event', e.id);
  return jsonb_build_object('ok', true, 'code', 'break_ended');
end;
$$;

-- qualquer carta que abre (nova ou retomada) encerra o intervalo; o evento terminar também
create or replace function public.app_round_opened_ends_break()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    update public.events set break_until = null, break_round_id = null
     where id = new.event_id and break_until is not null;
  end if;
  return null;
end;
$$;

create or replace trigger rounds_end_break
after insert or update of status on public.rounds
for each row execute function public.app_round_opened_ends_break();

create or replace function public.app_event_finished_ends_break()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'live' then
    new.break_until := null;
    new.break_round_id := null;
  end if;
  return new;
end;
$$;

create or replace trigger events_end_break
before update of status on public.events
for each row execute function public.app_event_finished_ends_break();

-- o agendador de 5 s também encerra os intervalos vencidos
create or replace function public.close_expired_rounds()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.events where break_until <= clock_timestamp() for update skip locked
  loop
    perform public.app_end_break(v_id);
  end loop;
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

-- a sala recebe o intervalo junto com a situação do evento
create or replace function public.app_broadcast_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.status is distinct from old.status or new.break_until is distinct from old.break_until)
     and old.status <> 'draft' and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(jsonb_build_object('event_status', new.status, 'break_until', new.break_until,
                                               'server_now', clock_timestamp()),
                            'event', 'sala:' || new.id, false);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists events_broadcast on public.events;
create trigger events_broadcast
after update of status, break_until on public.events
for each row execute function public.app_broadcast_event();

create or replace function public.room_state(p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_status public.event_status;
  v_break timestamptz;
  v_round uuid;
begin
  select status, break_until into v_status, v_break from public.events where id = p_event_id and status <> 'draft';
  if not found then
    -- rascunho só aparece para o leiloeiro (pré-visualização)
    select status, break_until into v_status, v_break from public.events where id = p_event_id and public.app_is_admin(seller_id);
    if not found then return null; end if;
  end if;
  select id into v_round from public.rounds
   where event_id = p_event_id
   order by (status in ('open', 'paused')) desc, closed_at desc nulls last, position
   limit 1;
  return jsonb_build_object('event_status', v_status, 'break_until', v_break, 'server_now', clock_timestamp(),
                            'state', case when v_round is null then null else public.app_round_state(v_round, auth.uid()) end);
end;
$$;

revoke execute on function public.app_end_break(uuid) from public, anon, authenticated;
revoke execute on function public.admin_start_break(uuid, int) from public, anon;
revoke execute on function public.admin_end_break(uuid) from public, anon;
grant execute on function public.admin_start_break(uuid, int) to authenticated;
grant execute on function public.admin_end_break(uuid) to authenticated;
revoke execute on function public.app_round_opened_ends_break() from public, anon, authenticated;
revoke execute on function public.app_event_finished_ends_break() from public, anon, authenticated;
