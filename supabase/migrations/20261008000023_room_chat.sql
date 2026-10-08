-- Chat da sala ao vivo (pedido do Tom: "o pessoal gosta de conversar no meio do leilão").
-- Só quem tem conta escreve, só com o evento ao vivo, até 280 letras, uma mensagem a cada 2 s.
-- O leiloeiro pode esconder mensagens. Cada mensagem nova (ou escondida) sai pelo mesmo
-- canal da sala (realtime.send), como as rodadas.

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  user_id uuid not null references public.profiles (id),
  nickname text not null,
  body text not null check (char_length(body) between 1 and 280),
  is_admin boolean not null default false,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id),
  created_at timestamptz not null default clock_timestamp()
);
create index room_messages_event on public.room_messages (event_id, created_at desc);
create index room_messages_user on public.room_messages (user_id, created_at desc);

alter table public.room_messages enable row level security;
-- mensagens visíveis de eventos publicados; quem escreveu não fica exposto (sem user_id na leitura)
create policy room_messages_read on public.room_messages for select using (
  hidden_at is null
  and exists (select 1 from public.events e where e.id = event_id and (e.status <> 'draft' or public.app_is_admin(e.seller_id)))
);
revoke all on public.room_messages from anon, authenticated;
grant select (id, event_id, nickname, body, is_admin, created_at) on public.room_messages to anon, authenticated;

create or replace function public.app_chat_payload(m public.room_messages)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('id', m.id, 'nickname', m.nickname, 'body', m.body, 'is_admin', m.is_admin, 'created_at', m.created_at)
$$;

create or replace function public.send_room_message(p_event_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_event public.events;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  v_msg public.room_messages;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'code', 'profile_required'); end if;
  if v_profile.status = 'blocked' then return jsonb_build_object('ok', false, 'code', 'blocked'); end if;
  if char_length(v_body) not between 1 and 280 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;

  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.status = 'draft' then return jsonb_build_object('ok', false, 'code', 'event_not_found'); end if;
  if v_event.status <> 'live' then return jsonb_build_object('ok', false, 'code', 'event_not_live'); end if;

  -- uma mensagem a cada 2 s por pessoa (trava por usuário evita duas em paralelo)
  perform pg_advisory_xact_lock(hashtext('chat:' || v_uid));
  if exists (select 1 from public.room_messages where user_id = v_uid and created_at > clock_timestamp() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  insert into public.room_messages (event_id, user_id, nickname, body, is_admin)
  values (p_event_id, v_uid, v_profile.nickname, v_body, public.app_is_admin(v_event.seller_id))
  returning * into v_msg;

  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(public.app_chat_payload(v_msg), 'chat', 'sala:' || p_event_id, false);
    exception when others then
      null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'code', 'sent', 'message', public.app_chat_payload(v_msg));
end;
$$;

create or replace function public.admin_hide_room_message(p_message_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_msg public.room_messages;
  v_seller uuid;
begin
  select m.* into v_msg from public.room_messages m where m.id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'message_not_found'); end if;
  select seller_id into v_seller from public.events where id = v_msg.event_id;
  if not public.app_is_admin(v_seller) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if v_msg.hidden_at is not null then return jsonb_build_object('ok', true, 'code', 'removed'); end if;

  update public.room_messages set hidden_at = clock_timestamp(), hidden_by = auth.uid() where id = p_message_id;
  perform public.app_audit(v_seller, 'chat.hide', 'room_message', p_message_id,
                           jsonb_build_object('nickname', v_msg.nickname, 'body', v_msg.body));
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(jsonb_build_object('id', p_message_id), 'chat_hide', 'sala:' || v_msg.event_id, false);
    exception when others then
      null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke execute on function public.send_room_message(uuid, text) from public, anon;
revoke execute on function public.admin_hide_room_message(uuid) from public, anon;
grant execute on function public.send_room_message(uuid, text) to authenticated;
grant execute on function public.admin_hide_room_message(uuid) to authenticated;
