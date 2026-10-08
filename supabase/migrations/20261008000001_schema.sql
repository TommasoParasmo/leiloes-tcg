-- Leilões TCG — schema base.
-- Convenções:
--   * Dinheiro sempre em centavos (bigint). Nunca float.
--   * Toda tabela de negócio tem seller_id (preparado para múltiplos leiloeiros).
--   * Escritas sensíveis (lances, arremates, pagamentos) só via funções SECURITY DEFINER.
--   * Horários sempre do servidor (clock_timestamp()/now()).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('buyer', 'admin');
create type public.user_status as enum ('active', 'blocked');
create type public.event_status as enum ('draft', 'scheduled', 'live', 'finished', 'cancelled');
create type public.auction_mode as enum ('highest_bid', 'speed');
create type public.close_mode as enum ('manual', 'timer');
create type public.round_status as enum ('queued', 'open', 'paused', 'closed', 'cancelled');
create type public.win_status as enum ('stored', 'in_order', 'paid', 'shipped', 'cancelled');
create type public.lot_status as enum ('open', 'closed', 'cancelled');
create type public.order_status as enum ('awaiting_shipping_quote', 'awaiting_payment', 'proof_sent', 'paid', 'shipped', 'delivered', 'cancelled');
create type public.payment_status as enum ('pending', 'proof_sent', 'confirmed', 'rejected', 'cancelled');
create type public.shipment_status as enum ('pending', 'quoted', 'label_created', 'posted', 'delivered', 'cancelled');
create type public.whatsapp_status as enum ('pending', 'sending', 'sent', 'failed', 'manual_pending', 'cancelled');

-- ---------------------------------------------------------------------------
-- Leiloeiros (sellers) e configurações
-- ---------------------------------------------------------------------------
create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  pix_key text,
  pix_receiver_name text,
  pix_receiver_city text,
  payment_days int not null default 7 check (payment_days between 1 and 60),
  max_accumulation_events int not null default 2 check (max_accumulation_events between 1 and 10),
  origin_address jsonb,
  whatsapp_group_name text,
  whatsapp_mode text not null default 'manual' check (whatsapp_mode in ('manual', 'automatic')),
  site_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  nickname text not null check (length(trim(nickname)) between 2 and 30),
  whatsapp text not null check (whatsapp ~ '^\+?[0-9]{10,15}$'),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  role public.user_role not null default 'buyer',
  admin_seller_id uuid references public.sellers (id),
  status public.user_status not null default 'active',
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_has_seller check (role <> 'admin' or admin_seller_id is not null)
);
create unique index profiles_nickname_key on public.profiles (lower(nickname));

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text,
  cep text not null check (cep ~ '^[0-9]{8}$'),
  street text not null,
  number text not null,
  complement text,
  district text not null,
  city text not null,
  state text not null check (state ~ '^[A-Z]{2}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index addresses_one_default on public.addresses (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- Eventos, cartas e rodadas
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  number int not null,                      -- "Leilão #15", sequencial por leiloeiro
  title text not null,
  starts_at timestamptz,
  status public.event_status not null default 'draft',
  share_slug text not null unique default encode(gen_random_bytes(6), 'hex'),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (seller_id, number)
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  name text not null,
  tcg text not null,                       -- Pokémon, One Piece, Magic, Lorcana, ...
  collection text,
  card_number text,
  language text,
  variant text,
  condition text,
  notes text,
  liga_price_cents bigint check (liga_price_cents is null or liga_price_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.card_photos (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create unique index card_photos_position on public.card_photos (card_id, position);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  event_id uuid not null references public.events (id),
  card_id uuid not null references public.cards (id),
  position int not null,
  mode public.auction_mode not null,
  status public.round_status not null default 'queued',
  -- maior lance
  start_price_cents bigint check (start_price_cents is null or start_price_cents > 0),
  increments_cents bigint[],               -- ex.: {100,200,500}
  bid_options_cents bigint[],              -- ex.: {600,700,800,900} (opções fixas)
  close_mode public.close_mode not null default 'manual',
  duration_seconds int check (duration_seconds is null or duration_seconds between 5 and 3600),
  -- rapidez
  fixed_price_cents bigint check (fixed_price_cents is null or fixed_price_cents > 0),
  -- estado
  opened_at timestamptz,
  ends_at timestamptz,
  paused_remaining_ms bigint,
  closed_at timestamptz,
  leading_bid_id uuid,
  current_amount_cents bigint,
  bid_count int not null default 0,
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique (event_id, position) deferrable initially deferred,
  constraint mode_fields check (
    (mode = 'speed' and fixed_price_cents is not null)
    or (mode = 'highest_bid' and (start_price_cents is not null or bid_options_cents is not null)
        and (increments_cents is not null or bid_options_cents is not null))
  ),
  constraint timer_has_duration check (close_mode = 'manual' or duration_seconds is not null)
);
create index rounds_event on public.rounds (event_id, position);
create unique index rounds_one_active_per_event on public.rounds (event_id) where status in ('open', 'paused');

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique, -- ordem oficial de chegada no servidor
  round_id uuid not null references public.rounds (id),
  user_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key)
);
create index bids_round on public.bids (round_id, seq desc);

alter table public.rounds
  add constraint rounds_leading_bid_fk foreign key (leading_bid_id) references public.bids (id);

-- ---------------------------------------------------------------------------
-- Arremates, lotes (acumulação), pedidos, pagamentos, frete
-- ---------------------------------------------------------------------------
create table public.lots (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  user_id uuid not null references public.profiles (id),
  status public.lot_status not null default 'open',
  first_event_id uuid not null references public.events (id),
  first_event_number int not null,
  accumulate_requested_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index lots_one_open on public.lots (seller_id, user_id) where status = 'open';

create table public.wins (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  round_id uuid not null unique references public.rounds (id), -- impede dois vencedores
  bid_id uuid not null unique references public.bids (id),
  user_id uuid not null references public.profiles (id),
  event_id uuid not null references public.events (id),
  card_id uuid not null references public.cards (id),
  lot_id uuid not null references public.lots (id),
  amount_cents bigint not null check (amount_cents > 0),
  status public.win_status not null default 'stored',
  won_at timestamptz not null default clock_timestamp()
);
create index wins_user on public.wins (user_id, won_at desc);
create index wins_lot on public.wins (lot_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  user_id uuid not null references public.profiles (id),
  lot_id uuid not null unique references public.lots (id),
  address_id uuid references public.addresses (id),
  shipping_address jsonb,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  shipping_cents bigint check (shipping_cents is null or shipping_cents >= 0),
  total_cents bigint generated always as (subtotal_cents + coalesce(shipping_cents, 0)) stored,
  status public.order_status not null default 'awaiting_shipping_quote',
  due_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  order_id uuid not null references public.orders (id),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'pix' check (method = 'pix'),
  status public.payment_status not null default 'pending',
  pix_payload text,
  proof_path text,
  proof_sent_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  due_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  order_id uuid not null unique references public.orders (id),
  provider text not null default 'superfrete',
  service_name text,
  price_cents bigint,
  delivery_days int,
  package jsonb,                            -- peso e dimensões reais
  quote_is_manual boolean not null default false,
  label_url text,
  tracking_code text,
  status public.shipment_status not null default 'pending',
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Penalidades (cartões amarelos)
-- ---------------------------------------------------------------------------
create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  user_id uuid not null references public.profiles (id),
  -- uma mesma dívida não gera várias advertências pelo mesmo atraso
  payment_id uuid unique references public.payments (id),
  reason text not null,
  issued_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removal_justification text,
  constraint removal_needs_justification check (removed_at is null or length(trim(removal_justification)) > 0)
);
create index penalties_active on public.penalties (user_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- WhatsApp, notificações e auditoria
-- ---------------------------------------------------------------------------
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  kind text not null check (kind in ('round_result', 'event_share')),
  round_id uuid references public.rounds (id),
  event_id uuid references public.events (id),
  payload jsonb not null,                   -- dados para montar texto + imagem
  status public.whatsapp_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
-- evita mensagens duplicadas para o mesmo resultado
create unique index whatsapp_one_result_per_round on public.whatsapp_messages (round_id) where kind = 'round_result';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  seller_id uuid references public.sellers (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity on public.audit_logs (entity, entity_id);
