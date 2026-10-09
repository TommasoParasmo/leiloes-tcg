-- Etiqueta do SuperFrete (pedido do Tom: a etiqueta vai para o carrinho do SuperFrete e ele paga lá).
-- O site manda o envio para o carrinho; depois de pago no SuperFrete, busca o rastreio e o PDF.
-- Nada é pago pelo site. O token fica só no servidor (rota /api/etiqueta).

-- remetente da etiqueta (o CEP já existe: origin_cep); limites do SuperFrete: rua 50, número 10, complemento 20
alter table public.seller_private
  add column sender_name text check (length(sender_name) between 2 and 80),
  add column sender_street text check (length(sender_street) between 2 and 50),
  add column sender_number text check (length(sender_number) between 1 and 10),
  add column sender_complement text check (length(sender_complement) <= 20),
  add column sender_district text check (length(sender_district) between 2 and 80),
  add column sender_city text check (length(sender_city) between 2 and 80),
  add column sender_state text check (sender_state ~ '^[A-Z]{2}$');

-- uma etiqueta por pedido; só o leiloeiro vê (tem o endereço de quem envia)
create table public.order_labels (
  order_id uuid primary key references public.orders (id),
  seller_id uuid not null references public.sellers (id),
  -- vazio enquanto a etiqueta está sendo criada (status 'creating')
  superfrete_order_id text check (superfrete_order_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  status text not null default 'creating' check (length(status) between 1 and 30),
  label_url text check (label_url ~ '^https://' and length(label_url) <= 1000),
  tracking_code text check (length(tracking_code) between 5 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_labels enable row level security;
create policy order_labels_admin_read on public.order_labels for select using (public.app_is_admin(seller_id));
revoke all on public.order_labels from anon, authenticated;
grant select on public.order_labels to authenticated;

create or replace function public.admin_update_sender(p_name text, p_street text, p_number text, p_complement text,
                                                     p_district text, p_city text, p_state text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_number text := nullif(btrim(coalesce(p_number, '')), '');
  v_compl text := nullif(btrim(coalesce(p_complement, '')), '');
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
begin
  select admin_seller_id into v_seller from public.profiles
   where id = auth.uid() and role = 'admin' and status = 'active';
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if (v_name is not null and length(v_name) not between 2 and 80)
     or (v_street is not null and length(v_street) not between 2 and 50)
     or (v_number is not null and length(v_number) > 10)
     or (v_compl is not null and length(v_compl) > 20)
     or (v_district is not null and length(v_district) not between 2 and 80)
     or (v_city is not null and length(v_city) not between 2 and 80)
     or (v_state is not null and v_state !~ '^[A-Z]{2}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  insert into public.seller_private (seller_id, sender_name, sender_street, sender_number, sender_complement,
                                     sender_district, sender_city, sender_state, updated_at)
  values (v_seller, v_name, v_street, v_number, v_compl, v_district, v_city, v_state, now())
  on conflict (seller_id) do update
    set sender_name = excluded.sender_name, sender_street = excluded.sender_street, sender_number = excluded.sender_number,
        sender_complement = excluded.sender_complement, sender_district = excluded.sender_district,
        sender_city = excluded.sender_city, sender_state = excluded.sender_state, updated_at = now();
  perform public.app_audit(v_seller, 'store.sender', 'seller', v_seller, jsonb_build_object('complete', v_name is not null and v_street is not null));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

-- Tudo que a etiqueta precisa: remetente, destinatário (nome e CPF do comprador), serviço e cartas.
create or replace function public.admin_label_input(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  o public.orders;
  s public.seller_private;
  b public.profiles;
  l public.order_labels;
  v_items jsonb;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  select * into l from public.order_labels where order_id = o.id;
  if o.status not in ('paid', 'shipped') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if o.shipping_address is null then return jsonb_build_object('ok', false, 'code', 'address_required'); end if;
  select * into s from public.seller_private where seller_id = o.seller_id;
  if s.origin_cep is null or s.sender_name is null or s.sender_street is null or s.sender_district is null
     or s.sender_city is null or s.sender_state is null then
    return jsonb_build_object('ok', false, 'code', 'sender_required');
  end if;
  select * into b from public.profiles where id = o.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'amount_cents', w.amount_cents) order by w.won_at), '[]'::jsonb)
    into v_items
    from public.wins w join public.cards c on c.id = w.card_id
   where w.lot_id = o.lot_id and w.status <> 'cancelled';

  return jsonb_build_object(
    'ok', true, 'code', 'label_input',
    'from', jsonb_build_object('name', s.sender_name, 'address', s.sender_street, 'number', s.sender_number,
                               'complement', s.sender_complement, 'district', s.sender_district,
                               'city', s.sender_city, 'state_abbr', s.sender_state, 'postal_code', s.origin_cep),
    'to', jsonb_build_object('name', b.full_name, 'document', b.cpf,
                             'address', o.shipping_address ->> 'street', 'number', o.shipping_address ->> 'number',
                             'complement', o.shipping_address ->> 'complement', 'district', o.shipping_address ->> 'district',
                             'city', o.shipping_address ->> 'city', 'state_abbr', o.shipping_address ->> 'state',
                             'postal_code', o.shipping_address ->> 'cep'),
    'service_name', (select service_name from public.shipments where order_id = o.id),
    'items', v_items,
    'label', case when l.order_id is null then null
                  else jsonb_build_object('superfrete_order_id', l.superfrete_order_id, 'status', l.status) end);
end;
$$;

-- Guarda o que o SuperFrete devolveu. Uma etiqueta cancelada lá pode ser trocada por uma nova.
create or replace function public.admin_save_label(p_order_id uuid, p_superfrete_order_id text, p_status text,
                                                  p_label_url text, p_tracking_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
  l public.order_labels;
  v_id text := btrim(coalesce(p_superfrete_order_id, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_url text := nullif(btrim(coalesce(p_label_url, '')), '');
  v_code text := nullif(upper(regexp_replace(coalesce(p_tracking_code, ''), '\s', '', 'g')), '');
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('paid', 'shipped') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if v_id !~ '^[A-Za-z0-9_-]{1,64}$' or length(v_status) not between 1 and 30
     or (v_url is not null and (v_url !~ '^https://' or length(v_url) > 1000))
     or (v_code is not null and length(v_code) not between 5 and 40) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into l from public.order_labels where order_id = o.id;
  -- só grava por cima da reserva feita por admin_reserve_label, da mesma etiqueta ou de uma cancelada
  if found and l.superfrete_order_id is not null and l.superfrete_order_id <> v_id
     and l.status not in ('canceled', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'label_exists');
  end if;
  insert into public.order_labels (order_id, seller_id, superfrete_order_id, status, label_url, tracking_code)
  values (o.id, o.seller_id, v_id, v_status, v_url, v_code)
  on conflict (order_id) do update
    set superfrete_order_id = excluded.superfrete_order_id, status = excluded.status,
        label_url = coalesce(excluded.label_url, case when public.order_labels.superfrete_order_id = excluded.superfrete_order_id then public.order_labels.label_url end),
        tracking_code = coalesce(excluded.tracking_code, case when public.order_labels.superfrete_order_id = excluded.superfrete_order_id then public.order_labels.tracking_code end),
        updated_at = now();
  if l.order_id is null or l.superfrete_order_id is distinct from v_id then
    perform public.app_audit(o.seller_id, 'order.label', 'order', o.id, jsonb_build_object('superfrete_order_id', v_id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

-- Reserva o pedido antes de chamar o SuperFrete: dois toques (ou duas abas) não criam duas etiquetas.
-- Uma reserva parada há mais de 2 minutos (servidor caiu no meio) pode ser refeita.
create or replace function public.admin_reserve_label(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
  v_ok boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if o.status not in ('paid', 'shipped') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  insert into public.order_labels (order_id, seller_id, superfrete_order_id, status)
  values (o.id, o.seller_id, null, 'creating')
  on conflict (order_id) do update
    set superfrete_order_id = null, status = 'creating', label_url = null, tracking_code = null, updated_at = now()
    where public.order_labels.status in ('canceled', 'cancelled', 'failed')
       or (public.order_labels.status = 'creating' and public.order_labels.updated_at < now() - interval '2 minutes')
  returning true into v_ok;
  if v_ok is null then return jsonb_build_object('ok', false, 'code', 'label_exists'); end if;
  return jsonb_build_object('ok', true, 'code', 'reserved');
end;
$$;

-- O SuperFrete recusou: libera a reserva para tentar de novo.
create or replace function public.admin_release_label(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  update public.order_labels set status = 'failed', updated_at = now()
   where order_id = o.id and status = 'creating' and superfrete_order_id is null;
  return jsonb_build_object('ok', true, 'code', 'released');
end;
$$;

revoke execute on function public.admin_update_sender(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.admin_label_input(uuid) from public, anon;
revoke execute on function public.admin_save_label(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_update_sender(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_label_input(uuid) to authenticated;
grant execute on function public.admin_save_label(uuid, text, text, text, text) to authenticated;
revoke execute on function public.admin_reserve_label(uuid) from public, anon;
revoke execute on function public.admin_release_label(uuid) from public, anon;
grant execute on function public.admin_reserve_label(uuid) to authenticated;
grant execute on function public.admin_release_label(uuid) to authenticated;
