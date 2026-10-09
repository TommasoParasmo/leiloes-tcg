import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

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

describe("criar leilão em um passo", () => {
  it("cria publicado, com as cartas na ordem e o lance padrão da loja", async () => {
    const cards = [await db.card(seller, "A"), await db.card(seller, "B"), await db.card(seller, "C")];
    const r = await db.rpc(admin, "admin_create_quick_event", ["Sexta, 10/10", at, [cards[2], cards[0], cards[1]]]);
    expect(r).toMatchObject({ ok: true, code: "published" });
    const [e] = await db.sql<{ status: string; title: string; number: number }>(`select status, title, number from events where id = $1`, [r.id]);
    expect(e).toMatchObject({ status: "scheduled", title: "Sexta, 10/10" });
    const rounds = await db.sql<{ card_id: string; position: number; mode: string; start_price_cents: string; increments_cents: string[]; close_mode: string; duration_seconds: number }>(
      `select card_id, position, mode, start_price_cents, increments_cents, close_mode, duration_seconds from rounds where event_id = $1 order by position`,
      [r.id],
    );
    expect(rounds.map((x) => x.card_id)).toEqual([cards[2], cards[0], cards[1]]);
    expect(rounds[0]).toMatchObject({ mode: "highest_bid", start_price_cents: "500", increments_cents: ["100", "200", "500"], close_mode: "timer", duration_seconds: 20 });
  });

  it("muda o lance padrão e o próximo leilão já usa", async () => {
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_update_round_defaults", [700, [500, 100], 30])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_update_round_defaults", [0, [100], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100, 200, 500, 1000], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100, -1], 20])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [500, [100], 4])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_round_defaults", [700, [500, 100], 30])).code).toBe("saved");
    const card = await db.card(seller, "D");
    const r = await db.rpc(admin, "admin_create_quick_event", ["Sábado", at, [card]]);
    const [x] = await db.sql<{ start_price_cents: string; increments_cents: string[]; duration_seconds: number }>(
      `select start_price_cents, increments_cents, duration_seconds from rounds where event_id = $1`,
      [r.id],
    );
    expect(x).toEqual({ start_price_cents: "700", increments_cents: ["100", "500"], duration_seconds: 30 });
    await db.rpc(admin, "admin_update_round_defaults", [500, [100, 200, 500], 20]);
  });

  it("tudo ou nada: carta já em outro leilão, de outra loja ou repetida não cria nada", async () => {
    const other = await db.seller();
    const free = await db.card(seller, "Livre");
    const foreign = await db.card(other, "De outra loja");
    const busy = await db.card(seller, "Ocupada");
    await db.rpc(admin, "admin_create_quick_event", ["Primeiro", at, [busy]]);
    const before = (await db.sql<{ n: string }>(`select count(*) n from events where seller_id = $1`, [seller]))[0].n;

    expect(await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, busy]])).toMatchObject({ ok: false, code: "card_unavailable", card_id: busy });
    expect(await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, foreign]])).toMatchObject({ ok: false, code: "card_not_found" });
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, [free, free]])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", at, []])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_create_quick_event", ["X", null, [free]])).code).toBe("invalid_request");
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_create_quick_event", ["X", at, [free]])).code).toBe("forbidden");

    const after = (await db.sql<{ n: string }>(`select count(*) n from events where seller_id = $1`, [seller]))[0].n;
    expect(after).toBe(before);
    expect((await db.sql(`select 1 from rounds where card_id = $1`, [free])).length).toBe(0);
  });

  it("dois leilões criados ao mesmo tempo ganham números diferentes e não dividem carta", async () => {
    const card = await db.card(seller, "Disputada");
    const [a, b] = await Promise.all([
      db.rpc(admin, "admin_create_quick_event", ["A", at, [card]]),
      db.rpc(admin, "admin_create_quick_event", ["B", at, [card]]),
    ]);
    expect([a.code, b.code].sort()).toEqual(["card_unavailable", "published"]);
    const [c, d] = await Promise.all([
      db.rpc(admin, "admin_create_quick_event", ["C", at, [await db.card(seller)]]),
      db.rpc(admin, "admin_create_quick_event", ["D", at, [await db.card(seller)]]),
    ]);
    expect(c.number).not.toBe(d.number);
  });
});
