import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
let buyer: string;
let eventNumber = 100;

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller });
  [buyer] = await db.users(1);
});
afterAll(async () => db?.destroy());

const positions = async (eventId: string) =>
  (await db.sql<{ id: string; position: number }>(`select id, position from rounds where event_id = $1 order by position`, [eventId])).map((r) => r.id);

describe("painel do leiloeiro", () => {
  it("cria eventos com número sequencial e só para admin", async () => {
    const a = await db.rpc(admin, "admin_create_event", ["Noite das Holos", "2026-10-20T23:00:00Z"]);
    const b = await db.rpc(admin, "admin_create_event", ["Mix TCG", null]);
    expect(a).toMatchObject({ ok: true, number: 1 });
    const [st] = await db.sql<{ status: string }>(`select status from events where id = $1`, [a.id]);
    expect(st.status).toBe("draft");
    expect(b).toMatchObject({ ok: true, number: 2 });
    expect((await db.rpc(buyer, "admin_create_event", ["x", null])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_create_event", ["  ", null])).code).toBe("invalid_request");
    await expect(db.rpc(null, "admin_create_event", ["x", null])).rejects.toThrow(/permission denied/);
  });

  it("publica o rascunho só com carta na fila", async () => {
    const { id } = (await db.rpc(admin, "admin_create_event", ["Rascunho", null])) as { id: string };
    expect((await db.rpc(admin, "admin_publish_event", [id])).code).toBe("queue_empty");
    await db.round(seller, id, { position: 1 });
    expect((await db.rpc(buyer, "admin_publish_event", [id])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_publish_event", [id])).code).toBe("published");
    expect((await db.rpc(admin, "admin_publish_event", [id])).code).toBe("event_already_published");
    const [ev] = await db.sql<{ status: string }>(`select status from events where id = $1`, [id]);
    expect(ev.status).toBe("scheduled");
    await expect(db.rpc(null, "admin_publish_event", [id])).rejects.toThrow(/permission denied/);
  });

  it("adiciona carta à fila só se ela estiver livre e o evento aberto", async () => {
    const e = await db.event(seller, eventNumber++);
    const card = await db.card(seller);
    const add = (eventId: string, cardId = card) =>
      db.rpc(admin, "admin_add_round", [eventId, cardId, "highest_bid", 500, [100, 200], null, null, "timer", 20]);

    const first = await add(e);
    expect(first.code).toBe("created");
    // mesma carta de novo (outra aba): recusada pelo servidor
    expect((await add(e)).code).toBe("card_unavailable");
    const other = await db.event(seller, eventNumber++);
    expect((await add(other)).code).toBe("card_unavailable");

    // encerrou sem lances: carta volta a ficar livre
    await db.rpc(admin, "admin_open_round", [first.id]);
    await db.rpc(admin, "admin_close_round", [first.id]);
    expect((await add(other)).code).toBe("created");

    // vendida: não volta
    const sold = await db.card(seller);
    const e3 = await db.event(seller, eventNumber++);
    const r = (await db.rpc(admin, "admin_add_round", [e3, sold, "speed", null, null, null, 1200, "manual", null])) as { id: string };
    await db.rpc(admin, "admin_open_round", [r.id]);
    const [fresh] = await db.users(1);
    expect((await db.rpc(fresh, "buy_now", [r.id, key()])).code).toBe("won");
    expect((await add(e3, sold)).code).toBe("card_unavailable");

    // evento encerrado não aceita carta nova
    await db.rpc(admin, "admin_finish_event", [e3]);
    expect((await add(e3, await db.card(seller))).code).toBe("event_already_finished");

    // configuração inválida, permissão e inserção direta pela API
    expect((await db.rpc(admin, "admin_add_round", [e, await db.card(seller), "speed", null, null, null, null, "manual", null])).code).toBe("invalid_request");
    expect((await db.rpc(buyer, "admin_add_round", [e, await db.card(seller), "speed", null, null, null, 100, "manual", null])).code).toBe("forbidden");
    const [priv] = await db.sql<{ ins: boolean; card: boolean }>(
      `select has_any_column_privilege('authenticated', 'rounds', 'insert') as ins, has_column_privilege('authenticated', 'rounds', 'card_id', 'update') as card`,
    );
    expect(priv).toEqual({ ins: false, card: false });
  });

  it("reordena só as rodadas da fila, depois das que já abriram", async () => {
    const e = await db.event(seller, eventNumber++);
    const r1 = await db.round(seller, e, { position: 1 });
    const r2 = await db.round(seller, e, { position: 2 });
    const r3 = await db.round(seller, e, { position: 3 });
    await db.rpc(admin, "admin_open_round", [r1]);

    expect((await db.rpc(admin, "admin_reorder_queue", [e, [r3, r2]])).ok).toBe(true);
    expect(await positions(e)).toEqual([r1, r3, r2]);

    // lista que não bate com a fila atual (faltando, repetida ou com a rodada aberta) é recusada
    expect((await db.rpc(admin, "admin_reorder_queue", [e, [r2]])).code).toBe("queue_changed");
    expect((await db.rpc(admin, "admin_reorder_queue", [e, [r2, r2]])).code).toBe("queue_changed");
    expect((await db.rpc(admin, "admin_reorder_queue", [e, [r1, r2]])).code).toBe("queue_changed");

    const other = await db.user({ role: "admin", sellerId: await db.seller() });
    expect((await db.rpc(other, "admin_reorder_queue", [e, [r2, r3]])).code).toBe("forbidden");
  });

  it("libera a próxima carta da fila e encerra o evento cancelando o que sobrou", async () => {
    const e = await db.event(seller, eventNumber++);
    const r1 = await db.round(seller, e, { position: 1, mode: "speed" });
    const r2 = await db.round(seller, e, { position: 2 });
    const r3 = await db.round(seller, e, { position: 3 });

    expect((await db.rpc(admin, "admin_open_next_round", [e])).code).toBe("opened");
    expect((await db.rpc(admin, "admin_open_next_round", [e])).code).toBe("another_round_active");
    expect((await db.rpc(admin, "admin_finish_event", [e])).code).toBe("another_round_active");
    expect((await db.rpc(buyer, "buy_now", [r1, key()])).code).toBe("won");

    const next = await db.rpc(admin, "admin_open_next_round", [e]);
    expect((next.state as { id: string }).id).toBe(r2);
    await db.rpc(admin, "admin_close_round", [r2]);

    expect(await db.rpc(admin, "admin_finish_event", [e])).toMatchObject({ ok: true, unsold: 1 });
    const [ev] = await db.sql<{ status: string }>(`select status from events where id = $1`, [e]);
    const [q] = await db.sql<{ status: string }>(`select status from rounds where id = $1`, [r3]);
    expect([ev.status, q.status]).toEqual(["finished", "cancelled"]);
    expect((await db.rpc(admin, "admin_open_next_round", [e])).code).toBe("queue_empty");
    expect((await db.rpc(admin, "admin_finish_event", [e])).code).toBe("event_already_finished");
  });

  it("marca a mensagem do WhatsApp como publicada ou com erro", async () => {
    const e = await db.event(seller, eventNumber++);
    const r = await db.round(seller, e, { mode: "speed" });
    await db.rpc(admin, "admin_open_round", [r]);
    await db.rpc(buyer, "buy_now", [r, key()]);
    const [m] = await db.sql<{ id: string; status: string }>(`select id, status from whatsapp_messages where round_id = $1`, [r]);
    expect(m.status).toBe("manual_pending");

    expect((await db.rpc(buyer, "admin_whatsapp_mark", [m.id, true, null])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_whatsapp_mark", [m.id, false, "Grupo fora do ar"])).code).toBe("failed");
    expect((await db.rpc(admin, "admin_whatsapp_mark", [m.id, true, null])).code).toBe("sent");
    expect((await db.rpc(admin, "admin_whatsapp_mark", [m.id, true, null])).code).toBe("message_already_done");
    const [after] = await db.sql<{ status: string; confirmed_by: string; sent_at: string | null; last_error: string | null }>(
      `select status, confirmed_by, sent_at, last_error from whatsapp_messages where id = $1`,
      [m.id],
    );
    expect(after).toMatchObject({ status: "sent", confirmed_by: admin, last_error: null });
    expect(after.sent_at).not.toBeNull();
  });

  it("lance que assume a liderança nos últimos 5 s soma 10 s ao cronômetro", async () => {
    const e = await db.event(seller, eventNumber++);
    const r = await db.round(seller, e, { timer: 60 });
    await db.rpc(admin, "admin_open_round", [r]);
    const [a, b] = await db.users(2);
    const endsAt = async () => (await db.sql<{ ms: number }>(`select extract(epoch from ends_at) * 1000 as ms from rounds where id = $1`, [r]))[0].ms;

    // longe do fim: não mexe
    const before = await endsAt();
    expect((await db.rpc(a, "place_bid", [r, 600, key()])).code).toBe("leading");
    expect(await endsAt()).toBe(before);

    // faltando 3 s: soma 10 s
    await db.sql(`update rounds set ends_at = clock_timestamp() + interval '3 seconds' where id = $1`, [r]);
    const late = await endsAt();
    expect((await db.rpc(b, "place_bid", [r, 700, key()])).code).toBe("leading");
    expect(Number(await endsAt()) - Number(late)).toBe(10_000);
  });

  it("qualquer um pede o fechamento, mas o servidor só fecha se o cronômetro acabou", async () => {
    const e = await db.event(seller, eventNumber++);
    const r = await db.round(seller, e, { timer: 5 });
    await db.rpc(admin, "admin_open_round", [r]);
    const [fresh] = await db.users(1); // o comprador dos testes acima já está no limite de acumulação
    expect((await db.rpc(fresh, "place_bid", [r, 600, key()])).ok).toBe(true);

    expect((await db.rpc(null, "close_round_if_expired", [r])).code).toBe("not_expired");
    await db.sql(`update rounds set ends_at = clock_timestamp() - interval '1 second' where id = $1`, [r]);
    const res = await db.rpc(null, "close_round_if_expired", [r]);
    expect(res.code).toBe("closed");
    expect((res.state as { status: string }).status).toBe("closed");
    const [w] = await db.sql<{ user_id: string }>(`select user_id from wins where round_id = $1`, [r]);
    expect(w.user_id).toBe(fresh);
    expect((await db.rpc(null, "close_round_if_expired", [r])).code).toBe("not_expired");
  });
});
