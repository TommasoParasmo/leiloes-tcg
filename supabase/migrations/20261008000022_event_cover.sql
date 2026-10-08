-- Imagem de fundo do evento (home "Ao vivo agora" e lista de eventos), escolhida pelo leiloeiro.
-- O arquivo fica no bucket card-photos, na pasta do leiloeiro: <seller_id>/eventos/<event_id>/<arquivo>.
alter table public.events add column if not exists cover_path text;

create or replace function public.admin_set_event_cover(p_event_id uuid, p_path text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if not public.app_is_admin(v_event.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_event.status in ('finished', 'cancelled') then return jsonb_build_object('ok', false, 'code', 'event_already_finished'); end if;
  -- só aceita arquivo na pasta deste evento (null volta para a imagem padrão)
  if p_path is not null
     and p_path !~ ('^' || v_event.seller_id || '/eventos/' || p_event_id || '/[A-Za-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  update public.events set cover_path = p_path where id = p_event_id;
  perform public.app_audit(v_event.seller_id, 'event.cover', 'event', p_event_id, jsonb_build_object('path', p_path));
  return jsonb_build_object('ok', true, 'code', 'saved', 'previous', v_event.cover_path);
end;
$$;

revoke execute on function public.admin_set_event_cover(uuid, text) from public, anon;
grant execute on function public.admin_set_event_cover(uuid, text) to authenticated;
