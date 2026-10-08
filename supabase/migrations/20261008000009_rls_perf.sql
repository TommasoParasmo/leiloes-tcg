-- Recomendações do Supabase (advisor de performance):
-- 1) auth.uid() dentro de (select ...) é avaliado uma vez por consulta, não por linha.
-- 2) índices nas chaves estrangeiras que as telas e as políticas consultam.
-- As regras de acesso não mudam: só a forma de escrever.

alter policy profiles_read_own on public.profiles using (id = (select auth.uid()));
alter policy profiles_insert_own on public.profiles with check (id = (select auth.uid()) and role = 'buyer' and status = 'active');
alter policy profiles_update_own on public.profiles using (id = (select auth.uid()));
alter policy addresses_own on public.addresses using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy bids_read_own on public.bids using (user_id = (select auth.uid()));
alter policy lots_read on public.lots using (user_id = (select auth.uid()) or public.app_is_admin(seller_id));
alter policy wins_read on public.wins using (user_id = (select auth.uid()) or public.app_is_admin(seller_id));
alter policy orders_read on public.orders using (user_id = (select auth.uid()) or public.app_is_admin(seller_id));
alter policy payments_read on public.payments using (
  public.app_is_admin(seller_id) or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
);
alter policy shipments_read on public.shipments using (
  public.app_is_admin(seller_id) or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
);
alter policy penalties_read on public.penalties using (user_id = (select auth.uid()) or public.app_is_admin(seller_id));
alter policy notifications_own_read on public.notifications using (user_id = (select auth.uid()));
alter policy notifications_own_update on public.notifications using (user_id = (select auth.uid()));

create index if not exists lots_user on public.lots (user_id);
create index if not exists wins_event on public.wins (event_id);
create index if not exists orders_user on public.orders (user_id);
create index if not exists payments_order on public.payments (order_id);
create index if not exists shipments_order on public.shipments (order_id);
create index if not exists cards_seller on public.cards (seller_id);
create index if not exists rounds_card_seller on public.rounds (card_id, seller_id);
