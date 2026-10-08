import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
let number = 1;

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller });
});
afterAll(async () => db?.destroy());

/** Simula o que o PostgREST faz antes de cada requisição (pgrst.db_pre_request). */
const preRequest = (userId: string | null, path: string, ip = "200.1.2.3") =>
  db.as(userId, async (c) => {
    await c.query(`select set_config('request.path', $1, true), set_config('request.headers', $2, true)`, [
      path,
      JSON.stringify({ "x-forwarded-for": `${ip}, 10.0.0.1` }),
    ]);
    await c.query(`select public.app_check_request()`);
  });

describe("limite de requisições", () => {
  it("lances: 15 em 10 s por pessoa; a 16ª volta 429 rate_limited", async () => {
    const [u, other] = await db.users(2);
    // começa logo depois de virar a janela de 10 s para o teste não atravessar duas janelas
    const ms = Date.now() % 10_000;
    if (ms > 7_000) await new Promise((r) => setTimeout(r, 10_050 - ms));
    for (let i = 0; i < 15; i++) await preRequest(u, "/rpc/place_bid");
    const err = await preRequest(u, "/rpc/buy_now").catch((e) => e);
    expect(err.code).toBe("PGRST");
    expect(JSON.parse(err.message).code).toBe("rate_limited");
    expect(JSON.parse(err.detail).status).toBe(429);
    // outra pessoa e outras rotas seguem livres
    await preRequest(other, "/rpc/place_bid");
    await preRequest(u, "/rpc/room_state");
  });

  it("checagem de apelido/WhatsApp: 40 por minuto por IP", async () => {
    const ms = Date.now() % 60_000;
    if (ms > 55_000) await new Promise((r) => setTimeout(r, 60_050 - ms));
    for (let i = 0; i < 40; i++) await preRequest(null, i % 2 ? "/rpc/nickname_available" : "/rpc/whatsapp_available", "198.51.100.7");
    await expect(preRequest(null, "/rpc/nickname_available", "198.51.100.7")).rejects.toThrow(/rate_limited/);
    await preRequest(null, "/rpc/nickname_available", "198.51.100.8");
  });

  it("leitura (transação só de leitura) nunca é barrada nem quebra", async () => {
    const [u] = await db.users(1);
    await db.as(u, async (c) => {
      await c.query(`set transaction read only`);
      await c.query(`select set_config('request.path', '/rpc/place_bid', true)`);
      for (let i = 0; i < 20; i++) await c.query(`select public.app_check_request()`);
    });
  });

  it("ninguém chama a função interna de contagem", async () => {
    const [u] = await db.users(1);
    await expect(db.as(u, (c) => c.query(`select private.rate_allow('x', 1, 1)`))).rejects.toThrow(/permission denied/);
  });
});

describe("exclusão da conta", () => {
  async function buyerWithAddress() {
    const [u] = await db.users(1);
    await db.sql(
      `insert into addresses (user_id, cep, street, number, district, city, state, is_default)
       values ($1, '01310100', 'Av. Paulista', '1578', 'Bela Vista', 'São Paulo', 'SP', true)`,
      [u],
    );
    return u;
  }

  it("apaga nome, apelido, e-mail e endereço; mantém CPF e WhatsApp; derruba as sessões", async () => {
    const u = await buyerWithAddress();
    await db.sql(`insert into auth.sessions (user_id) values ($1)`, [u]);
    await db.sql(`insert into notifications (user_id, kind, title, body) values ($1, 'x', 'Oi', 'Seu código é ABC')`, [u]);
    const [before] = await db.sql<{ cpf: string; whatsapp: string }>(`select cpf, whatsapp from profiles where id = $1`, [u]);

    expect((await db.rpc(u, "delete_my_account", [])).code).toBe("account_deleted");

    const [p] = await db.sql(`select full_name, nickname, cpf, whatsapp, status from profiles where id = $1`, [u]);
    expect(p.status).toBe("blocked");
    expect(p.full_name).toBe("Conta excluída");
    expect(p.nickname).toMatch(/^excluido-/);
    expect(p).toMatchObject({ cpf: before.cpf, whatsapp: before.whatsapp });
    expect(await db.sql(`select 1 from addresses where user_id = $1`, [u])).toHaveLength(0);
    expect(await db.sql(`select 1 from auth.sessions where user_id = $1`, [u])).toHaveLength(0);
    const [n] = await db.sql(`select body from notifications where user_id = $1`, [u]);
    expect(n.body).toBeNull();
    const [a] = await db.sql(`select email, encrypted_password, banned_until > now() + interval '100 years' as banned from auth.users where id = $1`, [u]);
    expect(a).toEqual({ email: `excluido+${u}@invalid.local`, encrypted_password: "", banned: true });
  });

  it("recusa com carta guardada no lote ou pedido em aberto, e para admin", async () => {
    const buyer = await buyerWithAddress();
    const e = await db.event(seller, number++);
    const r = await db.round(seller, e, { mode: "speed", fixedPrice: 1500 });
    await db.rpc(admin, "admin_open_round", [r]);
    expect((await db.rpc(buyer, "buy_now", [r, key()])).code).toBe("won");
    await db.rpc(admin, "admin_finish_event", [e]);
    expect((await db.rpc(buyer, "delete_my_account", [])).code).toBe("pending_lot");

    const [lot] = await db.sql<{ id: string }>(`select id from lots where user_id = $1`, [buyer]);
    expect((await db.rpc(admin, "admin_close_lot", [lot.id])).code).toBe("lot_closed");
    expect((await db.rpc(buyer, "delete_my_account", [])).code).toBe("pending_orders");

    expect((await db.rpc(admin, "delete_my_account", [])).code).toBe("forbidden");
    await expect(db.rpc(null, "delete_my_account", [])).rejects.toThrow(/permission denied/);
  });
});
