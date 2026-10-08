import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => db?.destroy());

describe("my_lots", () => {
  it("agrupa arremates por lote e conta 1/2 e 2/2", async () => {
    const s = await db.seller();
    const adm = await db.user({ role: "admin", sellerId: s });
    const [buyer, other] = await db.users(2);

    const win = async (n: number) => {
      const e = await db.event(s, n);
      const r = await db.round(s, e, { mode: "speed", fixedPrice: 900 });
      await db.rpc(adm, "admin_open_round", [r]);
      expect((await db.rpc(buyer, "buy_now", [r, key()])).code).toBe("won");
    };

    await win(15);
    let [lot] = (await db.rpc(buyer, "my_lots", [])) as unknown as Array<Record<string, unknown>>;
    expect(lot).toMatchObject({ first_event_number: 15, events_used: 1, max_events: 2, must_close: false, total_cents: 900 });

    await win(16);
    [lot] = (await db.rpc(buyer, "my_lots", [])) as unknown as Array<Record<string, unknown>>;
    expect(lot).toMatchObject({ events_used: 2, must_close: true, total_cents: 1800 });
    expect((lot.wins as unknown[]).length).toBe(2);

    expect(await db.rpc(other, "my_lots", [])).toEqual([]);
    await expect(db.rpc(null, "my_lots", [])).rejects.toThrow(/permission denied/);
  });
});
