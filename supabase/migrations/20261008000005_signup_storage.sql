-- Cadastro e fotos das cartas.

-- ---------------------------------------------------------------------------
-- Cadastro: o app chama supabase.auth.signUp() com os dados em `options.data`.
-- Este gatilho cria o perfil e o endereço na mesma transação do usuário, então
-- funciona mesmo com confirmação de e-mail ligada (quando ainda não há sessão).
-- Dados inválidos abortam o cadastro inteiro.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  a jsonb := m -> 'address';
begin
  if m ->> 'nickname' is null then
    return new; -- usuário criado pelo painel do Supabase (ex.: leiloeiro): perfil é criado à parte
  end if;

  insert into public.profiles (id, full_name, nickname, whatsapp, cpf)
  values (
    new.id,
    trim(m ->> 'full_name'),
    trim(m ->> 'nickname'),
    regexp_replace(m ->> 'whatsapp', '[^0-9+]', '', 'g'),
    nullif(regexp_replace(coalesce(m ->> 'cpf', ''), '[^0-9]', '', 'g'), '')
  );

  if a is not null then
    insert into public.addresses (user_id, cep, street, number, complement, district, city, state, is_default)
    values (
      new.id,
      regexp_replace(a ->> 'cep', '[^0-9]', '', 'g'),
      trim(a ->> 'street'),
      trim(a ->> 'number'),
      nullif(trim(coalesce(a ->> 'complement', '')), ''),
      trim(a ->> 'district'),
      trim(a ->> 'city'),
      upper(trim(a ->> 'state')),
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Apelido livre? (o formulário avisa antes de enviar)
create or replace function public.nickname_available(p_nickname text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select length(trim(coalesce(p_nickname, ''))) between 2 and 30
     and not exists (select 1 from public.profiles where lower(nickname) = lower(trim(p_nickname)));
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.nickname_available(text) from public;
grant execute on function public.nickname_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fotos das cartas: bucket público para leitura, escrita só do leiloeiro.
-- Caminho: <seller_id>/<card_id>/<arquivo>
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('card-photos', 'card-photos', true, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do nothing;

    execute $p$
      create policy card_photos_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'card-photos' and public.app_is_admin(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy card_photos_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'card-photos' and public.app_is_admin(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy card_photos_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'card-photos' and public.app_is_admin(((storage.foldername(name))[1])::uuid))
    $p$;
  end if;
end $$;
