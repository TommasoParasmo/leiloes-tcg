# Status do desenvolvimento

Plano completo: etapas 1 a 9 (ver thread "Dev" do projeto).

## Concluído

### Etapa 1 — Base (parcial)
- Projeto Next.js + TypeScript + Tailwind v4 com os tokens Ultra Holo e fontes Unbounded/Manrope.
- Schema completo do MVP (`supabase/migrations/…_schema.sql`): leiloeiros, perfis, endereços, eventos,
  cartas, fotos, rodadas, lances, lotes, arremates, pedidos, pagamentos, fretes, penalidades,
  mensagens de WhatsApp, notificações e auditoria. Dinheiro em centavos, `seller_id` em tudo.
- RLS: catálogo público; dados pessoais e financeiros só do dono e do leiloeiro; colunas de papel,
  bloqueio e estado das rodadas não graváveis pela API.
- CI (lint, typecheck, testes com Postgres, build).

### Motor de leilão (adiantado da etapa 3)
- `place_bid` (maior lance: opções fixas ou incrementos, desempate pelo primeiro), `buy_now` (rapidez),
  `admin_open/pause/resume/extend/close/cancel_round`, `close_expired_rounds` (cronômetro),
  `round_public_state` (estado da sala para visitantes).
- Encerramento vincula o arremate ao lote de acumulação, notifica o vencedor e enfileira a publicação no
  WhatsApp (modo manual por padrão).
- Bloqueio de participação: usuário bloqueado e comprador com lote que já passou por 2 leilões.
- 18 testes de banco, incluindo 200 arremates simultâneos (exatamente 1 vencedor) e 120 lances
  simultâneos em 3 ondas (líder sempre correto).

## Pendente

- Conectar a um projeto Supabase real (precisa das chaves) e ligar o Realtime.
- Telas (design v1 em `design/` da pasta do projeto): login/cadastro, sala ao vivo, painéis.
- Agendador para `close_expired_rounds` (pg_cron no Supabase).
- Etapas 2, 4–9 conforme o plano.

## Decisões tomadas (podem ser revistas)

- O líder atual não pode cobrir o próprio lance (evita lance duplicado por engano).
- Modo incrementos: o lance precisa superar o atual em no máximo o maior incremento configurado
  (protege contra erro de digitação).
- Modo opções fixas: lance igual ao atual é aceito e registrado, mas quem lançou primeiro segue
  liderando (regra de empate das votações do WhatsApp).
- Acumulação conta eventos do leiloeiro (não cancelados) desde o primeiro arremate do lote.

## A confirmar com o Tom

- Vencimento com acumulação (7 dias após o segundo leilão?) — antes da etapa 5.
