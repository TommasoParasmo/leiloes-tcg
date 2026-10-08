-- Visões do comprador: arremates agrupados por lote, com o contador de acumulação.

-- Eventos que já contam para a acumulação: os que começaram (ao vivo ou encerrados).
create or replace function public.app_lot_progress(p_lot public.lots)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.events e
  where e.seller_id = p_lot.seller_id
    and e.status in ('live', 'finished')
    and e.number >= p_lot.first_event_number;
$$;

-- Lotes do usuário logado com as cartas, total e "1/2" / "2/2".
create or replace function public.my_lots()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', l.id,
      'status', l.status,
      'created_at', l.created_at,
      'seller_name', s.name,
      'first_event_number', l.first_event_number,
      'events_used', least(public.app_lot_progress(l), s.max_accumulation_events + 1),
      'max_events', s.max_accumulation_events,
      'must_close', public.app_lot_progress(l) >= s.max_accumulation_events,
      'total_cents', (select coalesce(sum(w.amount_cents), 0) from public.wins w where w.lot_id = l.id and w.status <> 'cancelled'),
      'wins', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', w.id, 'amount_cents', w.amount_cents, 'won_at', w.won_at, 'status', w.status,
                 'card_name', c.name, 'card_variant', c.variant, 'event_number', e.number,
                 'photo_path', (select p.storage_path from public.card_photos p where p.card_id = c.id order by p.position limit 1))
               order by w.won_at)
        from public.wins w
        join public.cards c on c.id = w.card_id
        join public.events e on e.id = w.event_id
        where w.lot_id = l.id
      ), '[]'::jsonb)
    ) as x
    from public.lots l
    join public.sellers s on s.id = l.seller_id
    where l.user_id = auth.uid()
  ) t;
$$;

revoke execute on function public.app_lot_progress(public.lots) from public, anon, authenticated;
revoke execute on function public.my_lots() from public, anon;
grant execute on function public.my_lots() to authenticated;
