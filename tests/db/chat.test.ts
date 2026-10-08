import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
let n = 1;

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller });
});
afterAll(async () => db?.destroy());

const visible = (eventId: string, userId: string | null) =>
  db.as(userId, async (c) => (await c.query(`select nickname, body, is_admin from room_messages where event_id = $1 order by created_at`, [eventId])).rows);

describe("chat da sala", () => {
  it("quem tem conta conversa com o evento ao vivo; visitante só lê", async () => {
    const live = await db.event(seller, n++, "live");
    const [ana] = await db.users(1);
    expect((await db.rpc(ana, "send_room_message", [live, "  bora   Charizard!  "])).code).toBe("sent");
    expect((await db.rpc(admin, "send_room_message", [live, "Próxima carta já já"])).code).toBe("sent");
    const rows = await visible(live, null);
    expect(rows.map((r) => [r.body, r.is_admin])).toEqual([
      ["bora Charizard!", false],
      ["Próxima carta já já", true],
    ]);
    await expect(db.rpc(null, "send_room_message", [live, "oi"])).rejects.toThrow(/permission denied/);
    // ninguém lê quem escreveu
    await expect(db.as(null, (c) => c.query(`select user_id from room_messages`))).rejects.toThrow(/permission denied/);
    await expect(db.as(ana, (c) => c.query(`insert into room_messages (event_id, user_id, nickname, body) values ($1, $2, 'x', 'y')`, [live, ana]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("recusa evento fora do ar, texto vazio ou longo, conta bloqueada e mensagens seguidas", async () => {
    const live = await db.event(seller, n++, "live");
    const scheduled = await db.event(seller, n++, "scheduled");
    const [bia] = await db.users(1);
    const blocked = await db.user({ status: "blocked" });
    expect((await db.rpc(bia, "send_room_message", [scheduled, "oi"])).code).toBe("event_not_live");
    expect((await db.rpc(bia, "send_room_message", [live, "   "])).code).toBe("invalid_request");
    expect((await db.rpc(bia, "send_room_message", [live, "a".repeat(281)])).code).toBe("invalid_request");
    expect((await db.rpc(blocked, "send_room_message", [live, "oi"])).code).toBe("blocked");
    expect((await db.rpc(bia, "send_room_message", [live, "1"])).code).toBe("sent");
    expect((await db.rpc(bia, "send_room_message", [live, "2"])).code).toBe("rate_limited");
  });

  it("só o leiloeiro esconde mensagens, e elas somem para todos", async () => {
    const live = await db.event(seller, n++, "live");
    const [caio, dani] = await db.users(2);
    const sent = (await db.rpc(caio, "send_room_message", [live, "mensagem feia"])) as { message: { id: string } };
    expect((await db.rpc(dani, "admin_hide_room_message", [sent.message.id])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_hide_room_message", [sent.message.id])).code).toBe("removed");
    expect(await visible(live, dani)).toEqual([]);
    const [log] = await db.sql<{ action: string }>(`select action from audit_logs where entity_id = $1`, [sent.message.id]);
    expect(log.action).toBe("chat.hide");
  });
});
