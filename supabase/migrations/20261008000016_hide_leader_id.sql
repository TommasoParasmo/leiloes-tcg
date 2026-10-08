-- Lista de QA, item 26: visitante e usuários não leem mais o id interno do líder nem do
-- lance líder (pela tabela ou pelo tempo real). A sala usa o apelido.
-- Separada da 0015 porque quebra o site anterior (rounds(count) pede a linha inteira):
-- aplicar no Supabase só depois de publicar o site que conta com rounds(id).
-- Sem SELECT na tabela inteira, a contagem embutida do PostgREST (rounds(count)) deixa de
-- funcionar: os clientes contam com rounds(id).
revoke select on public.rounds from anon, authenticated;
grant select (id, seller_id, event_id, card_id, position, mode, status, start_price_cents, increments_cents,
              bid_options_cents, close_mode, duration_seconds, fixed_price_cents, opened_at, ends_at,
              paused_remaining_ms, closed_at, current_amount_cents, bid_count, cancel_reason, created_at,
              leading_nickname, rev)
  on public.rounds to anon, authenticated;
