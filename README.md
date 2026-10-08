# Leilão TCG

Plataforma de leilões ao vivo de cartas colecionáveis (Pokémon TCG, One Piece, Magic, Lorcana…).
O site é a fonte oficial dos resultados; o grupo do WhatsApp recebe a publicação de cada arremate.

## Stack

- Next.js (App Router) + React + TypeScript + Tailwind CSS v4 (tokens "Ultra Holo" em `src/app/tokens.css`)
- Supabase: Postgres, Auth, Realtime e Storage
- Regras críticas (lances, arremate, encerramento) em funções SQL atômicas: `supabase/migrations`
- Testes: Vitest contra um Postgres real

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha com as chaves do projeto Supabase
npm run dev
```

### Testes

Os testes de banco precisam de um Postgres 16 em `localhost:54329` com usuário `postgres` sem senha
(ou defina `TEST_DATABASE_URL_BASE`). Com Docker:

```bash
docker run -d --name leiloes-pg -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 -c max_connections=300
npm test
```

O setup cria um banco-modelo aplicando `supabase/tests/auth-shim.sql` (imita o `auth.uid()` do Supabase)
e todas as migrações; cada arquivo de teste usa uma cópia isolada.

## Como o motor de leilão garante um único vencedor

- Toda ação sobre uma rodada trava a linha (`SELECT … FOR UPDATE`), então lances simultâneos são
  processados um de cada vez, na ordem de chegada ao servidor (`bids.seq`).
- O horário é sempre o do banco (`clock_timestamp()`); o relógio do navegador nunca decide nada.
- `wins.round_id` é único: é impossível gravar dois arremates para a mesma rodada.
- Cada toque carrega uma chave de idempotência; repetir a requisição devolve o mesmo resultado.
- O encerramento grava o vencedor e apenas **enfileira** a mensagem do WhatsApp; o envio acontece fora
  da transação e nunca atrasa o encerramento.

Detalhes e pendências em [STATUS.md](STATUS.md).
