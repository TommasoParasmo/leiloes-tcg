-- Só rapidez por enquanto (decisão do Tom, 09/10): cada carta tem preço fixo no cadastro,
-- o leiloeiro mostra a carta e libera o botão; o primeiro toque confirmado leva.
-- O modelo de maior lance continua no banco, só deixa de ser criado pelo "Criar leilão".

alter table public.cards
  add column if not exists price_cents bigint check (price_cents is null or price_cents between 1 and 10000000);

-- Cria o leilão com as cartas em rapidez, cada uma pelo preço dela. Tudo ou nada.
create or replace function public.admin_create_quick_event(p_title text, p_starts_at timestamptz, p_card_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid := public.app_my_seller();
  v_id uuid;
  v_number int;
  v_card uuid;
  v_price bigint;
  v_pos int := 0;
begin
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if coalesce(length(trim(p_title)), 0) not between 1 and 120 or p_starts_at is null
     or coalesce(cardinality(p_card_ids), 0) not between 1 and 300
     or (select count(distinct x) from unnest(p_card_ids) x) <> cardinality(p_card_ids)
     or array_position(p_card_ids, null) is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform 1 from public.sellers where id = v_seller for update;
  perform 1 from public.cards where id = any (p_card_ids) for update;
  foreach v_card in array p_card_ids loop
    select price_cents into v_price from public.cards where id = v_card and seller_id = v_seller;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'card_not_found', 'card_id', v_card);
    end if;
    if exists (select 1 from public.rounds where card_id = v_card and status in ('queued', 'open', 'paused'))
       or exists (select 1 from public.wins where card_id = v_card and status <> 'cancelled') then
      return jsonb_build_object('ok', false, 'code', 'card_unavailable', 'card_id', v_card);
    end if;
    if v_price is null then
      return jsonb_build_object('ok', false, 'code', 'price_required', 'card_id', v_card);
    end if;
  end loop;

  select coalesce(max(number), 0) + 1 into v_number from public.events where seller_id = v_seller;
  insert into public.events (seller_id, number, title, starts_at, status)
  values (v_seller, v_number, trim(p_title), p_starts_at, 'scheduled')
  returning id into v_id;

  foreach v_card in array p_card_ids loop
    v_pos := v_pos + 1;
    insert into public.rounds (seller_id, event_id, card_id, position, mode, fixed_price_cents, close_mode)
    select v_seller, v_id, v_card, v_pos, 'speed', c.price_cents, 'manual' from public.cards c where c.id = v_card;
  end loop;

  perform public.app_audit(v_seller, 'event.create', 'event', v_id, jsonb_build_object('quick', true, 'cards', v_pos, 'mode', 'speed'));
  perform public.app_audit(v_seller, 'event.publish', 'event', v_id);
  return jsonb_build_object('ok', true, 'code', 'published', 'id', v_id, 'number', v_number);
end;
$$;

revoke execute on function public.admin_create_quick_event(text, timestamptz, uuid[]) from public, anon;
grant execute on function public.admin_create_quick_event(text, timestamptz, uuid[]) to authenticated;
