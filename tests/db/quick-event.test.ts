import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
const at = "2026-10-10T23:00:00Z";

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller });
});
afterAll(async () => db?.destroy());

/** Carta com preço (só rapidez: o preço vem do cadastro). */
async function priced(sellerId: string, name?: string, cents = 1200) {
  const id = await db.card(sellerId, name);
  await db.sql(`update cards set price_cents = $2 where id = $1`, [id, cents]);
  return id;
}

describe("criar leilão em um passo", () => {
  it("cria publicado, com as cartas na ordem, em rapidez pelo preço de cada uma", async () => {
    const cards = [await priced(seller, "A", 1500), await priced(seller, "B"), await priced(seller, "C", 900)];
    const r = await db.rpc(admin, "admin_create_quick_event", ["Sexta, 10/10", at, [cards[2], cards[0], cards[1]], 100]);
    expect(r).toMatchObject({ ok: true, code: "published" });
    const [e] = await db.sql<{ status: string; title: string; number: number }>(`select status, title, number from events where id = $1`, [r.id]);
    expect(e).toMatchObject({ status: "scheduled", title: "Sexta, 10/10" });
    const rounds = await db.sql<{ card_id: string; mode: string; bid_options_cents: string[]; fixed_price_cents: string; close_mode: string }>(
      `select card_id, mode, bid_options_cents, fixed_price_cents, close_mode from rounds where event_id = $1 order by position`,
      [r.id],
    );
    expect(rounds.map((x) => x.card_id)).toEqual([cards[2], cards[0], cards[1]]);
    // 4 botões a partir do mínimo da Liga, +R$ 1; o maior arremata na hora
    expect(rounds.map((x) => [x.mode, x.bid_options_cents.map(Number), x.fixed_price_cents, x.close_mode])).toEqual([
      ["highest_bid", [900, 1000, 1100, 1200], "1200", "manual"],
      ["highest_bid", [1500, 1600, 1700, 1800], "1800", "manual"],
      ["highest_bid", [1200, 1300, 1400, 1500], "1500", "manual"],
    ]);
  });

  it("degrau +R$ 2: 10, 12, 14, 16; outro degrau é recusado", async () => {
    const card = await priced(seller, "Dez", 1000);
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, [card], 500])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, [card], null])).code).toBe("invalid_request");
    const r = await db.rpc(admin, "admin_create_quick_event", ["X", at, [card], 200]);
    const [round] = await db.sql<{ bid_options_cents: string[]; fixed_price_cents: string }>(`select bid_options_cents, fixed_price_cents from rounds where event_id = $1`, [r.id]);
    expect(round.bid_options_cents.map(Number)).toEqual([1000, 1200, 1400, 1600]);
    expect(round.fixed_price_cents).toBe("1600");
  });

  it("no ar: tocar no maior valor arremata na hora; senão o leiloeiro fecha e leva o maior lance", async () => {
    const [a, b] = await db.users(2);
    const top = await priced(seller, "Topo", 1000);
    const mid = await priced(seller, "Meio", 1000);
    const r = await db.rpc(admin, "admin_create_quick_event", ["Ao vivo", at, [top, mid], 100]);
    const [r1, r2] = (await db.sql<{ id: string }>(`select id from rounds where event_id = $1 order by position`, [r.id])).map((x) => x.id);

    await db.rpc(admin, "admin_open_next_round", [r.id]);
    expect((await db.rpc(a, "place_bid", [r1, 1100, key()])).ok).toBe(true);
    expect(await db.rpc(b, "place_bid", [r1, 1300, key()])).toMatchObject({ ok: true });
    expect((await db.sql<{ status: string }>(`select status from rounds where id = $1`, [r1]))[0].status).toBe("closed");

    await db.rpc(admin, "admin_open_next_round", [r.id]);
    expect((await db.rpc(a, "place_bid", [r2, 1100, key()])).ok).toBe(true);
    expect((await db.sql<{ status: string }>(`select status from rounds where id = $1`, [r2]))[0].status).toBe("open");
    await db.rpc(admin, "admin_close_round", [r2]);
    const [w] = await db.sql<{ user_id: string; amount_cents: string }>(`select user_id, amount_cents from wins where round_id = $1`, [r2]);
    expect(w).toEqual({ user_id: a, amount_cents: "1100" });
  });

  it("carta sem preço não entra: avisa qual é e não cria nada", async () => {
    const ok = await priced(seller, "Com preço");
    const none = await db.card(seller, "Sem preço");
    expect(await db.rpc(admin, "admin_create_quick_event", ["X", at, [ok, none], 100])).toMatchObject({ ok: false, code: "price_required", card_id: none });
    expect((await db.sql(`select 1 from rounds where card_id = $1`, [ok])).length).toBe(0);
  });

  it("lance padrão da loja: só o leiloeiro muda, com valores válidos (guardado para quando o lance voltar)", async () => {
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_update_round_defaults", [700, [500, 100], 30])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_update_round_defaults", [0, [100], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100, 200, 500, 1000], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100, -1], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100], 4])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [700, [500, 100], 30])).code).toBe("saved");
    await db.rpc(admin, "admin_update_round_defaults", [500, [100, 200, 500], 20]);
  });

  it("tudo ou nada: carta já em outro leilão, de outra loja ou repetida não cria nada", async () => {
    const other = await db.seller();
    const free = await priced(seller, "Livre");
    const foreign = await priced(other, "De outra loja");
    const busy = await priced(seller, "Ocupada");
    await db.rpc(admin, "admin_create_quick_event", ["Primeiro", at, [busy], 100]);
    const before = (await db.sql<{ n: string }>(`select count(*) n from events where seller_id = $1`, [seller]))[0].n;

    expect(await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, busy], 100])).toMatchObject({ ok: false, code: "card_unavailable", card_id: busy });
    expect(await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, foreign], 100])).toMatchObject({ ok: false, code: "card_not_found" });
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, free], 100])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, [], 100])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", null, [free], 100])).code).toBe("invalid_request");
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_create_quick_event", ["X", at, [free], 100])).code).toBe("forbidden");

    const after = (await db.sql<{ n: string }>(`select count(*) n from events where seller_id = $1`, [seller]))[0].n;
    expect(after).toBe(before);
    expect((await db.sql(`select 1 from rounds where card_id = $1`, [free])).length).toBe(0);
  });

  it("dois leilões criados ao mesmo tempo ganham números diferentes e não dividem carta", async () => {
    const card = await priced(seller, "Disputada");
    const [a, b] = await Promise.all([
      db.rpc(admin, "admin_create_quick_event", ["A", at, [card], 100]),
      db.rpc(admin, "admin_create_quick_event", ["B", at, [card], 100]),
    ]);
    expect([a.code, b.code].sort()).toEqual(["card_unavailable", "published"]);
    const [c, d] = await Promise.all([
      db.rpc(admin, "admin_create_quick_event", ["C", at, [await priced(seller)], 100]),
      db.rpc(admin, "admin_create_quick_event", ["D", at, [await priced(seller)], 100]),
    ]);
    expect(c.number).not.toBe(d.number);
  });
});
