-- Reproduz o mínimo do ambiente Supabase (schema auth, auth.uid(), papéis) para
-- rodar as migrações e os testes num Postgres comum. NÃO é aplicado no Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- Realtime: realtime.send() grava o que seria transmitido, para os testes conferirem.
create schema if not exists realtime;
create table if not exists realtime.sent (id bigserial primary key, topic text, event text, payload jsonb, private boolean);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language sql
as $$ insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private); $$;

-- Colunas do auth.users que a exclusão de conta usa; sessões do Auth.
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists encrypted_password text;
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
