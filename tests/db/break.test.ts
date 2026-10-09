import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
let eventNumber = 300;

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller, nickname: "leiloeiro" });
});
afterAll(async () => db?.destroy());

async function liveRound(timer = 60) {
  const eventId = await db.event(seller, eventNumber++);
  const roundId = await db.round(seller, eventId, { startPrice: 600, increments: [100], timer });
  expect((await db.rpc(admin, "admin_open_round", [roundId])).code).toBe("opened");
  return { eventId, roundId };
}

const eventRow = async (id: string) =>
  (await db.sql<{ break_until: Date | null; break_round_id: string | null }>(`select break_until, break_round_id from events where id = $1`, [id]))[0];
const roundRow = async (id: string) =>
  (await db.sql<{ status: string; paused_remaining_ms: string | null; secs: number | null }>(
    `select status, paused_remaining_ms, extract(epoch from ends_at - clock_timestamp())::float as secs from rounds where id = $1`,
    [id],
  ))[0];

describe("intervalo do leilão", () => {
  it("só o leiloeiro, só ao vivo e de 1 a 10 minutos", async () => {
    const { eventId } = await liveRound();
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_start_break", [eventId, 5])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_start_break", [eventId, 0])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_start_break", [eventId, 11])).code).toBe("invalid_request");
    const scheduled = await db.event(seller, eventNumber++);
    expect((await db.rpc(admin, "admin_start_break", [scheduled, 5])).code).toBe("event_not_live");
  });

  it("congela a carta aberta, bloqueia lances e volta com o tempo que faltava", async () => {
    const { eventId, roundId } = await liveRound(60);
    const [buyer] = await db.users(1);
    const res = await db.rpc(admin, "admin_start_break", [eventId, 10]);
    expect(res.code).toBe("break_started");
    expect((await db.rpc(admin, "admin_start_break", [eventId, 5])).code).toBe("break_active");

    const e = await eventRow(eventId);
    expect(e.break_round_id).toBe(roundId);
    const mins = (e.break_until!.getTime() - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(9.9);
    expect(mins).toBeLessThanOrEqual(10);
    expect((await roundRow(roundId)).status).toBe("paused");
    expect((await db.rpc(buyer, "place_bid", [roundId, 600, key()])).code).toBe("round_paused");

    // a sala vê o intervalo
    const room = (await db.rpc(buyer, "room_state", [eventId])) as { break_until: string | null };
    expect(room.break_until).not.toBeNull();

    expect((await db.rpc(admin, "admin_end_break", [eventId])).code).toBe("break_ended");
    expect(await eventRow(eventId)).toEqual({ break_until: null, break_round_id: null });
    const r = await roundRow(roundId);
    expect(r.status).toBe("open");
    expect(r.secs).toBeGreaterThan(55);
    expect(r.secs).toBeLessThanOrEqual(60);
    expect((await db.rpc(buyer, "place_bid", [roundId, 600, key()])).code).toBe("leading");
  });

  it("acaba sozinho quando o tempo termina (agendador)", async () => {
    const { eventId, roundId } = await liveRound(60);
    expect((await db.rpc(admin, "admin_start_break", [eventId, 1])).code).toBe("break_started");
    await db.sql(`update events set break_until = clock_timestamp() - interval '1 second' where id = $1`, [eventId]);
    await db.sql(`select public.close_expired_rounds()`);
    expect((await eventRow(eventId)).break_until).toBeNull();
    expect((await roundRow(roundId)).status).toBe("open");
  });

  it("abrir ou retomar uma carta encerra o intervalo; carta pausada antes continua pausada", async () => {
    const { eventId, roundId } = await liveRound(60);
    expect((await db.rpc(admin, "admin_pause_round", [roundId])).code).toBe("paused");
    expect((await db.rpc(admin, "admin_start_break", [eventId, 5])).code).toBe("break_started");
    expect((await eventRow(eventId)).break_round_id).toBeNull();
    // fim do intervalo não retoma a carta que o leiloeiro tinha pausado por conta própria
    expect((await db.rpc(admin, "admin_end_break", [eventId])).code).toBe("break_ended");
    expect((await roundRow(roundId)).status).toBe("paused");

    expect((await db.rpc(admin, "admin_start_break", [eventId, 5])).code).toBe("break_started");
    expect((await db.rpc(admin, "admin_resume_round", [roundId])).code).toBe("resumed");
    expect((await eventRow(eventId)).break_until).toBeNull();
  });

  it("não cria outra ligação entre events e rounds (a API ficaria sem saber qual usar em rounds(...))", async () => {
    const fks = await db.sql(
      `select conname from pg_constraint where contype = 'f' and conrelid = 'public.events'::regclass and confrelid = 'public.rounds'::regclass`,
    );
    expect(fks).toEqual([]);
  });

  it("intervalo sem carta aberta e evento encerrado limpa o intervalo", async () => {
    const { eventId, roundId } = await liveRound(60);
    expect((await db.rpc(admin, "admin_close_round", [roundId])).code).toMatch(/^closed/);
    expect((await db.rpc(admin, "admin_start_break", [eventId, 3])).code).toBe("break_started");
    expect((await eventRow(eventId)).break_round_id).toBeNull();
    await db.sql(`update events set status = 'finished' where id = $1`, [eventId]);
    expect((await eventRow(eventId)).break_until).toBeNull();
  });
});
