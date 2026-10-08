import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { adminUrl, TEMPLATE_DB } from "./config";

let phoneSeq = 0;
const uniqueWhatsapp = () => `119${String(process.pid % 1000).padStart(3, "0")}${String(phoneSeq++).padStart(5, "0")}`;

/** CPF aleatório com dígitos verificadores válidos. */
export function randomCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    const sum = d.slice(0, len).reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
    d.push(((sum * 10) % 11) % 10);
  }
  return d.join("");
}

export type Json = Record<string, unknown> & { ok?: boolean; code?: string };

/** Banco isolado por arquivo de teste, clonado do template com as migrações. */
export class TestDb {
  private constructor(public readonly name: string, public readonly pool: Pool) {}

  static async create(): Promise<TestDb> {
    const name = `leiloes_t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    await admin.end();
    const pool = new Pool({ connectionString: adminUrl(name), max: 80 });
    // O `drop database ... with (force)` do destroy() derruba conexões que ainda estão
    // fechando; sem este handler o pg emite um erro não tratado (57P01) e o Vitest falha.
    pool.on("error", () => {});
    return new TestDb(name, pool);
  }

  async destroy() {
    await this.pool.end();
    const admin = new Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name} with (force)`);
    await admin.end();
  }

  /** Consulta como superusuário (montagem de cenário, verificações). */
  async sql<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }

  /** Executa como um usuário autenticado (papel `authenticated` + JWT sub), como o Supabase faz. */
  async as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async rpc(userId: string | null, fn: string, args: unknown[]): Promise<Json> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    return this.as(userId, async (c) => {
      const res = await c.query(`select public.${fn}(${placeholders}) as r`, args);
      return res.rows[0].r as Json;
    });
  }

  // ---------------------------------------------------------------- cenário

  async seller(overrides: Partial<{ whatsapp_mode: string; max_accumulation_events: number }> = {}) {
    const [s] = await this.sql<{ id: string }>(
      `insert into sellers (name, slug, whatsapp_mode, max_accumulation_events)
       values ('Loja Teste', $1, $2, $3) returning id`,
      [`loja-${randomUUID().slice(0, 8)}`, overrides.whatsapp_mode ?? "manual", overrides.max_accumulation_events ?? 2],
    );
    return s.id;
  }

  async user(opts: { nickname?: string; role?: "buyer" | "admin"; sellerId?: string; status?: "active" | "blocked"; cpf?: string | null } = {}) {
    const id = randomUUID();
    await this.sql(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@teste.dev`]);
    await this.sql(
      `insert into profiles (id, full_name, nickname, whatsapp, cpf, role, admin_seller_id, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        "Pessoa Teste",
        opts.nickname ?? `u${id.slice(0, 8)}`,
        uniqueWhatsapp(),
        opts.cpf === undefined ? randomCpf() : opts.cpf,
        opts.role ?? "buyer",
        opts.sellerId ?? null,
        opts.status ?? "active",
      ],
    );
    return id;
  }

  async users(n: number) {
    return Promise.all(Array.from({ length: n }, (_, i) => this.user({ nickname: `c${i}_${randomUUID().replace(/-/g, "").slice(0, 12)}` })));
  }

  async event(sellerId: string, number: number, status = "scheduled") {
    const [e] = await this.sql<{ id: string }>(
      `insert into events (seller_id, number, title, status) values ($1, $2, $3, $4) returning id`,
      [sellerId, number, `Leilão #${number}`, status],
    );
    return e.id;
  }

  async card(sellerId: string, name = "Horsea") {
    const [c] = await this.sql<{ id: string }>(
      `insert into cards (seller_id, name, tcg, variant) values ($1, $2, 'Pokémon', 'Poké Ball Holo') returning id`,
      [sellerId, name],
    );
    await this.sql(`insert into card_photos (card_id, storage_path, position) values ($1, $2, 0)`, [c.id, `cards/${c.id}/1.jpg`]);
    return c.id;
  }

  async round(
    sellerId: string,
    eventId: string,
    opts: {
      mode?: "highest_bid" | "speed";
      position?: number;
      startPrice?: number;
      increments?: number[];
      options?: number[];
      fixedPrice?: number;
      timer?: number;
    } = {},
  ) {
    const cardId = await this.card(sellerId);
    const mode = opts.mode ?? "highest_bid";
    const [r] = await this.sql<{ id: string }>(
      `insert into rounds (seller_id, event_id, card_id, position, mode, start_price_cents, increments_cents,
                           bid_options_cents, fixed_price_cents, close_mode, duration_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        sellerId,
        eventId,
        cardId,
        opts.position ?? 1,
        mode,
        mode === "highest_bid" && !opts.options ? (opts.startPrice ?? 600) : null,
        mode === "highest_bid" && !opts.options ? (opts.increments ?? [100, 200, 500]) : null,
        opts.options ?? null,
        mode === "speed" ? (opts.fixedPrice ?? 1000) : null,
        opts.timer ? "timer" : "manual",
        opts.timer ?? null,
      ],
    );
    return r.id;
  }
}

export const key = () => randomUUID();
