-- "Minha loja": o leiloeiro preenche o Pix e o CEP de onde as cartas saem (para o SuperFrete).
-- O CEP de origem fica numa tabela só do leiloeiro (a tabela sellers é de leitura pública).

create table public.seller_private (
  seller_id uuid primary key references public.sellers (id),
  origin_cep text check (origin_cep ~ '^[0-9]{8}$'),
  updated_at timestamptz not null default now()
);
alter table public.seller_private enable row level security;
create policy seller_private_admin_read on public.seller_private for select using (public.app_is_admin(seller_id));
revoke all on public.seller_private from anon, authenticated;
grant select on public.seller_private to authenticated;

create or replace function public.admin_update_store(p_pix_key text, p_pix_name text, p_pix_city text, p_origin_cep text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid;
  v_key text := nullif(btrim(coalesce(p_pix_key, '')), '');
  v_name text := nullif(btrim(coalesce(p_pix_name, '')), '');
  v_city text := nullif(btrim(coalesce(p_pix_city, '')), '');
  v_cep text := nullif(regexp_replace(coalesce(p_origin_cep, ''), '[^0-9]', '', 'g'), '');
begin
  select admin_seller_id into v_seller from public.profiles
   where id = auth.uid() and role = 'admin' and status = 'active';
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if (v_key is not null and length(v_key) > 77)
     or (v_name is not null and length(v_name) > 60)
     or (v_city is not null and length(v_city) > 40)
     or (v_cep is not null and v_cep !~ '^[0-9]{8}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  update public.sellers set pix_key = v_key, pix_receiver_name = v_name, pix_receiver_city = v_city where id = v_seller;
  insert into public.seller_private (seller_id, origin_cep, updated_at) values (v_seller, v_cep, now())
  on conflict (seller_id) do update set origin_cep = excluded.origin_cep, updated_at = now();
  perform public.app_audit(v_seller, 'store.update', 'seller', v_seller,
                           jsonb_build_object('pix_key_set', v_key is not null, 'origin_cep', v_cep));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

-- Dados para cotar o frete de um pedido: CEP de origem, CEP do comprador e quantas cartas.
create or replace function public.admin_shipping_quote_input(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  o public.orders;
  v_from text;
  v_cards int;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if not public.app_is_admin(o.seller_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  select origin_cep into v_from from public.seller_private where seller_id = o.seller_id;
  select count(*) into v_cards from public.wins where lot_id = o.lot_id and status <> 'cancelled';
  return jsonb_build_object('ok', true, 'code', 'quoted', 'from_cep', v_from, 'to_cep', o.shipping_address ->> 'cep', 'cards', v_cards);
end;
$$;

revoke execute on function public.admin_update_store(text, text, text, text) from public, anon;
revoke execute on function public.admin_shipping_quote_input(uuid) from public, anon;
grant execute on function public.admin_update_store(text, text, text, text) to authenticated;
grant execute on function public.admin_shipping_quote_input(uuid) to authenticated;
