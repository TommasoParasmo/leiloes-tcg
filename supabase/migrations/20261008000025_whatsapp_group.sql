-- Link do grupo do WhatsApp da loja (pedido do Tom: "Abrir no WhatsApp" deve ir para o grupo da Nai).
-- O WhatsApp não aceita texto pronto num link de grupo; o painel copia o texto e abre o grupo para colar.
-- Fica na tabela só do leiloeiro: o convite do grupo não aparece para quem não é da loja.

alter table public.seller_private
  add column whatsapp_group_url text check (whatsapp_group_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,40}$');

drop function public.admin_update_store(text, text, text, text);

create or replace function public.admin_update_store(p_pix_key text, p_pix_name text, p_pix_city text, p_origin_cep text, p_group_url text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seller uuid;
  v_key text := nullif(btrim(coalesce(p_pix_key, '')), '');
  v_name text := nullif(btrim(coalesce(p_pix_name, '')), '');
  v_city text := nullif(btrim(coalesce(p_pix_city, '')), '');
  v_cep text := nullif(regexp_replace(coalesce(p_origin_cep, ''), '[^0-9]', '', 'g'), '');
  -- o convite copiado do WhatsApp vem com "?mode=..." no fim: guarda só o endereço do grupo
  v_group text := nullif(regexp_replace(btrim(coalesce(p_group_url, '')), '[?#].*$', ''), '');
begin
  select admin_seller_id into v_seller from public.profiles
   where id = auth.uid() and role = 'admin' and status = 'active';
  if v_seller is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if (v_key is not null and length(v_key) > 77)
     or (v_name is not null and length(v_name) > 60)
     or (v_city is not null and length(v_city) > 40)
     or (v_cep is not null and v_cep !~ '^[0-9]{8}$')
     or (v_group is not null and v_group !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,40}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  update public.sellers set pix_key = v_key, pix_receiver_name = v_name, pix_receiver_city = v_city where id = v_seller;
  insert into public.seller_private (seller_id, origin_cep, whatsapp_group_url, updated_at) values (v_seller, v_cep, v_group, now())
  on conflict (seller_id) do update set origin_cep = excluded.origin_cep, whatsapp_group_url = excluded.whatsapp_group_url, updated_at = now();
  perform public.app_audit(v_seller, 'store.update', 'seller', v_seller,
                           jsonb_build_object('pix_key_set', v_key is not null, 'origin_cep', v_cep, 'whatsapp_group_set', v_group is not null));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke execute on function public.admin_update_store(text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_store(text, text, text, text, text) to authenticated;
