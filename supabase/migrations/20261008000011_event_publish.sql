-- Evento nasce como rascunho (só o leiloeiro vê) e vai para "Próximos eventos"
-- quando ele publica. Publicar exige pelo menos uma carta configurada na fila.

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
  values (v_seller, v_number, trim(p_title), p_starts_at, 'draft')
  returning id into v_id;
  perform public.app_audit(v_seller, 'event.create', 'event', v_id);
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id, 'number', v_number);
end;
$$;

create or replace function public.admin_publish_event(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_event.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_event.status <> 'draft' then return jsonb_build_object('ok', false, 'code', 'event_already_published'); end if;
  if not exists (select 1 from public.rounds where event_id = p_event_id and status = 'queued') then
    return jsonb_build_object('ok', false, 'code', 'queue_empty');
  end if;
  update public.events set status = 'scheduled' where id = p_event_id;
  perform public.app_audit(v_event.seller_id, 'event.publish', 'event', p_event_id);
  return jsonb_build_object('ok', true, 'code', 'published');
end;
$$;

revoke execute on function public.admin_publish_event(uuid) from public, anon;
grant execute on function public.admin_publish_event(uuid) to authenticated;
