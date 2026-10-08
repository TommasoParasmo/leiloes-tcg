-- Bate Carta — Row Level Security.
-- Leitura pública: catálogo (eventos publicados, cartas, fotos, rodadas).
-- Dados pessoais e financeiros: só o dono e o leiloeiro.
-- Escritas sensíveis: só via funções (lances, arremates, pagamentos, penalidades).

-- Leiloeiro de qualquer vendedor (SECURITY DEFINER evita recursão na política de profiles).
create or replace function public.app_is_any_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;
revoke execute on function public.app_is_any_admin() from public, anon;
grant execute on function public.app_is_any_admin() to authenticated;

alter table public.sellers enable row level security;
alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.events enable row level security;
alter table public.cards enable row level security;
alter table public.card_photos enable row level security;
alter table public.rounds enable row level security;
alter table public.bids enable row level security;
alter table public.lots enable row level security;
alter table public.wins enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.shipments enable row level security;
alter table public.penalties enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Vendedores: dados públicos de vitrine.
create policy sellers_read on public.sellers for select using (true);
create policy sellers_admin_update on public.sellers for update using (public.app_is_admin(id));

-- Perfis: o próprio usuário e o leiloeiro.
create policy profiles_read_own on public.profiles for select using (id = auth.uid());
create policy profiles_read_admin on public.profiles for select using (
  public.app_is_any_admin()
);
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid() and role = 'buyer' and status = 'active');
create policy profiles_update_own on public.profiles for update using (id = auth.uid());
-- Papel e bloqueio nunca podem ser alterados pelo próprio usuário.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, nickname, whatsapp, cpf) on public.profiles to authenticated;

-- Endereços: CRUD do dono; leiloeiro lê.
create policy addresses_own on public.addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_admin_read on public.addresses for select using (
  public.app_is_any_admin()
);

-- Catálogo
create policy events_read on public.events for select using (status <> 'draft' or public.app_is_admin(seller_id));
create policy events_admin_write on public.events for all using (public.app_is_admin(seller_id)) with check (public.app_is_admin(seller_id));
create policy cards_read on public.cards for select using (true);
create policy cards_admin_write on public.cards for all using (public.app_is_admin(seller_id)) with check (public.app_is_admin(seller_id));
create policy card_photos_read on public.card_photos for select using (true);
create policy card_photos_admin_write on public.card_photos for all
  using (exists (select 1 from public.cards c where c.id = card_id and public.app_is_admin(c.seller_id)))
  with check (exists (select 1 from public.cards c where c.id = card_id and public.app_is_admin(c.seller_id)));

-- Rodadas: leitura pública; criação/edição de rodadas na fila pelo leiloeiro.
-- Mudanças de estado (abrir, encerrar...) só pelas funções admin_*.
create policy rounds_read on public.rounds for select using (
  exists (select 1 from public.events e where e.id = event_id and (e.status <> 'draft' or public.app_is_admin(e.seller_id)))
);
create policy rounds_admin_insert on public.rounds for insert with check (public.app_is_admin(seller_id) and status = 'queued');
create policy rounds_admin_update_queued on public.rounds for update
  using (public.app_is_admin(seller_id) and status = 'queued')
  with check (public.app_is_admin(seller_id) and status = 'queued');
create policy rounds_admin_delete_queued on public.rounds for delete using (public.app_is_admin(seller_id) and status = 'queued');
-- Colunas de estado nunca são graváveis pela API.
revoke insert, update on public.rounds from anon, authenticated;
grant insert (seller_id, event_id, card_id, position, mode, start_price_cents, increments_cents, bid_options_cents,
              close_mode, duration_seconds, fixed_price_cents)
  on public.rounds to authenticated;
grant update (card_id, position, mode, start_price_cents, increments_cents, bid_options_cents,
              close_mode, duration_seconds, fixed_price_cents)
  on public.rounds to authenticated;

-- Lances: o histórico público sai por round_public_state(); tabela crua só dono/leiloeiro.
create policy bids_read_own on public.bids for select using (user_id = auth.uid());
create policy bids_read_admin on public.bids for select using (
  exists (select 1 from public.rounds r where r.id = round_id and public.app_is_admin(r.seller_id))
);

-- Dados do comprador (somente leitura direta; escrita via funções)
create policy lots_read on public.lots for select using (user_id = auth.uid() or public.app_is_admin(seller_id));
create policy wins_read on public.wins for select using (user_id = auth.uid() or public.app_is_admin(seller_id));
create policy orders_read on public.orders for select using (user_id = auth.uid() or public.app_is_admin(seller_id));
create policy payments_read on public.payments for select using (
  public.app_is_admin(seller_id) or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
create policy shipments_read on public.shipments for select using (
  public.app_is_admin(seller_id) or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
create policy penalties_read on public.penalties for select using (user_id = auth.uid() or public.app_is_admin(seller_id));

-- Notificações: o dono lê e marca como lida.
create policy notifications_own_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update using (user_id = auth.uid());
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Só o leiloeiro
create policy whatsapp_admin_read on public.whatsapp_messages for select using (public.app_is_admin(seller_id));
create policy audit_admin_read on public.audit_logs for select using (public.app_is_admin(seller_id));

-- Tempo real: a sala escuta mudanças em rounds (estado) e busca round_public_state().
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rounds;
  end if;
end $$;
