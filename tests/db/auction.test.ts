import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, TestDb } from "./helpers";

let db: TestDb;
let seller: string;
let admin: string;
let eventNumber = 100;

beforeAll(async () => {
  db = await TestDb.create();
  seller = await db.seller();
  admin = await db.user({ role: "admin", sellerId: seller, nickname: "leiloeiro" });
});
afterAll(async () => db?.destroy());

async function openRound(opts: Parameters<TestDb["round"]>[2] = {}) {
  const eventId = await db.event(seller, eventNumber++);
  const roundId = await db.round(seller, eventId, opts);
  const res = await db.rpc(admin, "admin_open_round", [roundId]);
  expect(res.code).toBe("opened");
  return { eventId, roundId };
}

describe("Modo B — rapidez", () => {
  it("200 toques simultâneos geram exatamente um vencedor", async () => {
    const { roundId } = await openRound({ mode: "speed", fixedPrice: 1500 });
    const buyers = await db.users(200);

    const results = await Promise.all(buyers.map((u) => db.rpc(u, "buy_now", [roundId, key()])));

    const won = results.filter((r) => r.code === "won");
    const sold = results.filter((r) => r.code === "already_sold");
    expect(won).toHaveLength(1);
    expect(sold).toHaveLength(199);

    const wins = await db.sql(`select * from wins where round_id = $1`, [roundId]);
    expect(wins).toHaveLength(1);
    expect(wins[0].amount_cents).toBe("1500");
    const bids = await db.sql(`select * from bids where round_id = $1`, [roundId]);
    expect(bids).toHaveLength(1);
    const [round] = await db.sql(`select status from rounds where id = $1`, [roundId]);
    expect(round.status).toBe("closed");
    const msgs = await db.sql(`select * from whatsapp_messages where round_id = $1`, [roundId]);
    expect(msgs).toHaveLength(1);
  });

  it("não aceita arremate antes de a rodada começar", async () => {
    const eventId = await db.event(seller, eventNumber++);
    const roundId = await db.round(seller, eventId, { mode: "speed" });
    const [u] = await db.users(1);
    const res = await db.rpc(u, "buy_now", [roundId, key()]);
    expect(res.code).toBe("round_not_started");
  });

  it("toque repetido com a mesma chave não cria segundo registro", async () => {
    const { roundId } = await openRound({ mode: "speed" });
    const [u] = await db.users(1);
    const k = key();
    const [a, b] = await Promise.all([db.rpc(u, "buy_now", [roundId, k]), db.rpc(u, "buy_now", [roundId, k])]);
    expect([a.code, b.code].sort()).toEqual(["duplicate", "won"]);
    const bids = await db.sql(`select * from bids where round_id = $1`, [roundId]);
    expect(bids).toHaveLength(1);
  });
});

describe("Modo A — maior lance", () => {
  it("lances simultâneos mantêm o líder correto (maior valor, empate pelo primeiro)", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100, 200, 500] });
    const buyers = await db.users(120);

    // três ondas de lances simultâneos, cada um tentando o lance atual + incremento aleatório
    for (let wave = 0; wave < 3; wave++) {
      const [state] = await db.sql<{ current_amount_cents: string | null }>(
        `select current_amount_cents from rounds where id = $1`,
        [roundId],
      );
      const base = state.current_amount_cents ? Number(state.current_amount_cents) : 600;
      await Promise.all(
        buyers.map((u) => {
          const inc = [0, 100, 200, 500][Math.floor(Math.random() * 4)];
          const amount = state.current_amount_cents ? base + (inc || 100) : base + inc;
          return db.rpc(u, "place_bid", [roundId, amount, key()]);
        }),
      );
    }

    const bids = await db.sql<{ id: string; amount_cents: string; seq: string }>(
      `select id, amount_cents, seq from bids where round_id = $1 order by seq`,
      [roundId],
    );
    expect(bids.length).toBeGreaterThan(0);

    // cada lance aceito precisa ter superado o anterior (sem opções fixas não há empate)
    for (let i = 1; i < bids.length; i++) {
      expect(Number(bids[i].amount_cents)).toBeGreaterThan(Number(bids[i - 1].amount_cents));
    }

    const expected = [...bids].sort((a, b) => Number(b.amount_cents) - Number(a.amount_cents) || Number(a.seq) - Number(b.seq))[0];
    const [round] = await db.sql<{ leading_bid_id: string; current_amount_cents: string; bid_count: number }>(
      `select leading_bid_id, current_amount_cents, bid_count from rounds where id = $1`,
      [roundId],
    );
    expect(round.leading_bid_id).toBe(expected.id);
    expect(round.current_amount_cents).toBe(expected.amount_cents);
    expect(round.bid_count).toBe(bids.length);

    const closed = await db.rpc(admin, "admin_close_round", [roundId]);
    expect(closed.code).toBe("closed_with_winner");
    const [win] = await db.sql(`select bid_id, amount_cents from wins where round_id = $1`, [roundId]);
    expect(win.bid_id).toBe(expected.id);
  });

  it("opções fixas: empate no valor, vence quem lançou primeiro", async () => {
    const { roundId } = await openRound({ options: [600, 700, 800, 900] });
    const [joao, marina] = await Promise.all([db.user({ nickname: "Joao" }), db.user({ nickname: "Marina" })]);

    const first = await db.rpc(joao, "place_bid", [roundId, 900, key()]);
    const second = await db.rpc(marina, "place_bid", [roundId, 900, key()]);
    expect(first.code).toBe("leading");
    expect(second.code).toBe("tie_not_leading");
    // empate repetido travava a rodada: cada pessoa lança cada valor uma vez só
    expect((await db.rpc(marina, "place_bid", [roundId, 900, key()])).code).toBe("amount_already_bid");

    const low = await db.rpc(marina, "place_bid", [roundId, 800, key()]);
    expect(low.code).toBe("amount_too_low");
    const notOption = await db.rpc(marina, "place_bid", [roundId, 950, key()]);
    expect(notOption.code).toBe("invalid_amount");

    const closed = await db.rpc(admin, "admin_close_round", [roundId]);
    expect(closed.winner_nickname).toBe("Joao");
  });

  it("rapidez com opções: o maior valor arremata na hora; sem ele, vale o maior lance no fim", async () => {
    const [tom, naiara, bia] = await Promise.all([db.user({ nickname: "Tom" }), db.user({ nickname: "Naiara" }), db.user({ nickname: "Bia" })]);

    // ninguém chega no 13: Naiara (12) leva quando o leiloeiro encerra
    const a = await openRound({ options: [1000, 1100, 1200, 1300], fixedPrice: 1300 });
    expect((await db.rpc(tom, "place_bid", [a.roundId, 1100, key()])).code).toBe("leading");
    expect((await db.rpc(naiara, "place_bid", [a.roundId, 1200, key()])).code).toBe("leading");
    expect((await db.rpc(admin, "admin_close_round", [a.roundId])).winner_nickname).toBe("Naiara");

    // alguém vai direto no 13: arremata na hora, mesmo com tempo sobrando
    const b = await openRound({ options: [1000, 1100, 1200, 1300], fixedPrice: 1300, timer: 60 });
    expect((await db.rpc(tom, "place_bid", [b.roundId, 1100, key()])).code).toBe("leading");
    const [first, second] = [
      await db.rpc(bia, "place_bid", [b.roundId, 1300, key()]),
      await db.rpc(naiara, "place_bid", [b.roundId, 1300, key()]),
    ];
    expect(first.code).toBe("won");
    expect(second.code).toBe("round_closed");
    const [win] = await db.sql<{ nickname: string; amount_cents: number }>(
      "select p.nickname, w.amount_cents::int from wins w join profiles p on p.id = w.user_id where w.round_id = $1",
      [b.roundId],
    );
    expect(win).toEqual({ nickname: "Bia", amount_cents: 1300 });
  });

  it("rapidez com opções: 30 toques simultâneos no maior valor geram um só vencedor", async () => {
    const { roundId } = await openRound({ options: [1000, 1300], fixedPrice: 1300 });
    const buyers = await Promise.all(Array.from({ length: 30 }, (_, i) => db.user({ nickname: `t${i}_${key().slice(0, 6)}` })));
    const results = await Promise.all(buyers.map((u) => db.rpc(u, "place_bid", [roundId, 1300, key()])));
    expect(results.filter((r) => r.code === "won")).toHaveLength(1);
    const [{ n }] = await db.sql<{ n: number }>("select count(*)::int n from wins where round_id = $1", [roundId]);
    expect(n).toBe(1);
  });

  it("valor de arremate na hora só vale com opções e precisa ser o maior", async () => {
    const eventId = await db.event(seller, eventNumber++);
    await expect(db.round(seller, eventId, { options: [1000, 1300], fixedPrice: 1200 })).rejects.toThrow(/instant_price_needs_options/);
    await expect(db.round(seller, eventId, { fixedPrice: 1200 })).rejects.toThrow(/instant_price_needs_options/);
  });

  it("valida limites de valor e não deixa o líder cobrir o próprio lance", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100, 200, 500] });
    const [a, b] = await db.users(2);

    expect((await db.rpc(a, "place_bid", [roundId, 500, key()])).code).toBe("amount_too_low");
    expect((await db.rpc(a, "place_bid", [roundId, 1200, key()])).code).toBe("amount_too_high");
    expect((await db.rpc(a, "place_bid", [roundId, 600, key()])).code).toBe("leading");
    expect((await db.rpc(a, "place_bid", [roundId, 700, key()])).code).toBe("already_leading");
    expect((await db.rpc(b, "place_bid", [roundId, 600, key()])).code).toBe("amount_too_low");
    // só os passos configurados: +3,47 enviado direto à API não passa
    expect((await db.rpc(b, "place_bid", [roundId, 947, key()])).code).toBe("invalid_amount");
    expect((await db.rpc(b, "place_bid", [roundId, 800, key()])).code).toBe("leading");

    const notes = await db.sql(`select kind from notifications where user_id = $1`, [a]);
    expect(notes.map((n) => n.kind)).toContain("outbid");
  });

  it("recusa lance depois do fim do cronômetro e encerra com o vencedor", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100], timer: 30 });
    const [a, b] = await db.users(2);
    expect((await db.rpc(a, "place_bid", [roundId, 600, key()])).code).toBe("leading");

    await db.sql(`update rounds set ends_at = clock_timestamp() - interval '1 millisecond' where id = $1`, [roundId]);
    const late = await db.rpc(b, "place_bid", [roundId, 700, key()]);
    expect(late.code).toBe("round_closed");

    const [win] = await db.sql(`select user_id from wins where round_id = $1`, [roundId]);
    expect(win.user_id).toBe(a);
    const again = await db.rpc(admin, "admin_close_round", [roundId]);
    expect(again.code).toBe("round_not_open");
  });

  it("close_expired_rounds encerra rodadas vencidas pelo cronômetro", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100], timer: 30 });
    const [a] = await db.users(1);
    await db.rpc(a, "place_bid", [roundId, 600, key()]);
    await db.sql(`update rounds set ends_at = clock_timestamp() - interval '1 second' where id = $1`, [roundId]);
    const [{ n }] = await db.sql<{ n: number }>(`select public.close_expired_rounds() as n`);
    expect(n).toBeGreaterThanOrEqual(1);
    const [round] = await db.sql(`select status from rounds where id = $1`, [roundId]);
    expect(round.status).toBe("closed");
  });

  it("pausar, estender e retomar preservam o tempo restante", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100], timer: 60 });
    const [a] = await db.users(1);

    expect((await db.rpc(admin, "admin_pause_round", [roundId])).code).toBe("paused");
    expect((await db.rpc(a, "place_bid", [roundId, 600, key()])).code).toBe("round_paused");
    expect((await db.rpc(admin, "admin_extend_round", [roundId, 15])).code).toBe("extended");
    const [paused] = await db.sql<{ paused_remaining_ms: string }>(`select paused_remaining_ms from rounds where id = $1`, [roundId]);
    expect(Number(paused.paused_remaining_ms)).toBeGreaterThan(70_000);

    expect((await db.rpc(admin, "admin_resume_round", [roundId])).code).toBe("resumed");
    const [open] = await db.sql<{ secs: number }>(
      `select extract(epoch from ends_at - clock_timestamp())::float as secs from rounds where id = $1`,
      [roundId],
    );
    expect(open.secs).toBeGreaterThan(70);
    expect(open.secs).toBeLessThanOrEqual(75);
    expect((await db.rpc(a, "place_bid", [roundId, 600, key()])).code).toBe("leading");
  });

  it("rodada cancelada não gera arremate e exige justificativa", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100] });
    const [a] = await db.users(1);
    await db.rpc(a, "place_bid", [roundId, 600, key()]);
    expect((await db.rpc(admin, "admin_cancel_round", [roundId, " "])).code).toBe("reason_required");
    expect((await db.rpc(admin, "admin_cancel_round", [roundId, "Carta danificada"])).code).toBe("cancelled");
    expect(await db.sql(`select 1 from wins where round_id = $1`, [roundId])).toHaveLength(0);
    expect((await db.rpc(a, "place_bid", [roundId, 700, key()])).code).toBe("round_closed");
  });

  it("só uma rodada ativa por evento", async () => {
    const eventId = await db.event(seller, eventNumber++);
    const r1 = await db.round(seller, eventId, { position: 1 });
    const r2 = await db.round(seller, eventId, { position: 2 });
    expect((await db.rpc(admin, "admin_open_round", [r1])).code).toBe("opened");
    expect((await db.rpc(admin, "admin_open_round", [r2])).code).toBe("another_round_active");
  });
});

describe("Permissões e participação", () => {
  it("visitante lê o catálogo publicado e não vê dados pessoais", async () => {
    const { eventId } = await openRound({ startPrice: 600, increments: [100] });
    const read = (sql: string, params: unknown[] = []) => db.as(null, (c) => c.query(sql, params));
    expect((await read(`select id from events where id = $1`, [eventId])).rows).toHaveLength(1);
    expect((await read(`select id from rounds where event_id = $1`, [eventId])).rows).toHaveLength(1);
    expect((await read(`select id from cards limit 1`)).rows).toHaveLength(1);
    expect((await read(`select id from profiles`)).rows).toHaveLength(0);
    expect((await read(`select id from addresses`)).rows).toHaveLength(0);
  });

  it("visitante e comprador não controlam rodadas", async () => {
    const eventId = await db.event(seller, eventNumber++);
    const roundId = await db.round(seller, eventId);
    const [u] = await db.users(1);
    expect((await db.rpc(u, "admin_open_round", [roundId])).code).toBe("forbidden");
    await expect(db.rpc(null, "place_bid", [roundId, 600, key()])).rejects.toThrow(/permission denied/);
  });

  it("admin de outro leiloeiro não controla a rodada", async () => {
    const other = await db.seller();
    const otherAdmin = await db.user({ role: "admin", sellerId: other });
    const eventId = await db.event(seller, eventNumber++);
    const roundId = await db.round(seller, eventId);
    expect((await db.rpc(otherAdmin, "admin_open_round", [roundId])).code).toBe("forbidden");
  });

  it("usuário bloqueado não lança nem arremata, mas visitante vê o estado", async () => {
    const blocked = await db.user({ status: "blocked" });
    const { roundId } = await openRound({ startPrice: 600, increments: [100] });
    expect((await db.rpc(blocked, "place_bid", [roundId, 600, key()])).code).toBe("blocked");
    const { roundId: speed } = await openRound({ mode: "speed" });
    expect((await db.rpc(blocked, "buy_now", [speed, key()])).code).toBe("blocked");
    const state = await db.rpc(null, "round_public_state", [roundId]);
    expect(state.status).toBe("open");
    expect(state.my_block).toBe("not_authenticated");
    expect((await db.rpc(blocked, "round_public_state", [roundId])).my_block).toBe("blocked");
    const [ok] = await db.users(1);
    expect((await db.rpc(ok, "round_public_state", [roundId])).my_block).toBeNull();
  });

  it("estado da rodada conta a carta dentro do evento mesmo com lacunas de posição", async () => {
    const eventId = await db.event(seller, eventNumber++);
    await db.round(seller, eventId, { position: 3 });
    const second = await db.round(seller, eventId, { position: 10 });
    await db.round(seller, eventId, { position: 20 });
    const state = await db.rpc(null, "round_public_state", [second]);
    expect([state.ordinal, state.round_total]).toEqual([2, 3]);
  });

  it("admin não cria rodada com evento ou carta de outro leiloeiro", async () => {
    const other = await db.seller();
    const otherAdmin = await db.user({ role: "admin", sellerId: other });
    const foreignEvent = await db.event(seller, eventNumber++);
    const foreignCard = await db.card(seller);
    const ownEvent = await db.event(other, 1);
    const ownCard = await db.card(other);
    const add = (eventId: string, cardId: string) => db.rpc(otherAdmin, "admin_add_round", [eventId, cardId, "speed", null, null, null, 500, "manual", null]);
    expect((await add(foreignEvent, ownCard)).code).toBe("forbidden");
    expect((await add(ownEvent, foreignCard)).code).toBe("card_not_found");
    expect((await add(ownEvent, ownCard)).code).toBe("created");
    // inserir direto pela API não é mais permitido
    await expect(
      db.as(otherAdmin, (c) =>
        c.query(`insert into rounds (seller_id, event_id, card_id, position, mode, fixed_price_cents) values ($1, $2, $3, 2, 'speed', 500)`, [other, ownEvent, ownCard]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("admin só vê dados pessoais de compradores da própria loja", async () => {
    const other = await db.seller();
    const otherAdmin = await db.user({ role: "admin", sellerId: other });
    const { roundId } = await openRound({ startPrice: 600, increments: [100] });
    const [buyer, stranger] = await db.users(2);
    await db.rpc(buyer, "place_bid", [roundId, 600, key()]);
    await db.sql(
      `insert into addresses (user_id, cep, street, number, district, city, state) values ($1, '01001000', 'Praça da Sé', '1', 'Sé', 'São Paulo', 'SP')`,
      [buyer],
    );
    const visible = (who: string) =>
      db.as(who, async (c) => ({
        profiles: (await c.query(`select id from profiles where id = any($1)`, [[buyer, stranger]])).rows.map((r) => r.id),
        addresses: (await c.query(`select id from addresses where user_id = $1`, [buyer])).rows.length,
      }));
    expect(await visible(admin)).toEqual({ profiles: [buyer], addresses: 1 });
    expect(await visible(otherAdmin)).toEqual({ profiles: [], addresses: 0 });
  });

  it("comprador não escreve direto em lances, arremates nem no próprio papel", async () => {
    const { roundId } = await openRound({ startPrice: 600, increments: [100] });
    const [u] = await db.users(1);
    await expect(
      db.as(u, (c) => c.query(`insert into bids (round_id, user_id, amount_cents, idempotency_key) values ($1, $2, 99999, 'xxxxxxxxxx')`, [roundId, u])),
    ).rejects.toThrow(/row-level security/);
    await expect(db.as(u, (c) => c.query(`update profiles set role = 'admin' where id = $1`, [u]))).rejects.toThrow(/permission denied/);
    await expect(db.as(u, (c) => c.query(`update profiles set status = 'active' where id = $1`, [u]))).rejects.toThrow(/permission denied/);
    const upd = await db.as(u, (c) => c.query(`update rounds set status = 'closed' where id = $1`, [roundId]).catch((e) => e));
    expect(String(upd)).toMatch(/permission denied/);
    const others = await db.as(u, (c) => c.query(`select id from profiles where id <> $1`, [u]));
    expect(others.rows).toHaveLength(0);
  });
});

describe("Arremate, acumulação e WhatsApp", () => {
  it("arremate entra no lote, gera mensagem e respeita o limite de 2 leilões", async () => {
    const s = await db.seller();
    const adm = await db.user({ role: "admin", sellerId: s });
    const [buyer] = await db.users(1);

    const play = async (number: number) => {
      const eventId = await db.event(s, number);
      const roundId = await db.round(s, eventId, { mode: "speed", fixedPrice: 900 });
      await db.rpc(adm, "admin_open_round", [roundId]);
      return db.rpc(buyer, "buy_now", [roundId, key()]);
    };

    expect((await play(15)).code).toBe("won");
    expect((await play(16)).code).toBe("won");
    expect((await play(17)).code).toBe("must_close_lot");

    const lots = await db.sql(`select id, first_event_number from lots where user_id = $1 and seller_id = $2`, [buyer, s]);
    expect(lots).toHaveLength(1);
    expect(lots[0].first_event_number).toBe(15);
    const wins = await db.sql(`select lot_id from wins where user_id = $1 and seller_id = $2`, [buyer, s]);
    expect(wins).toHaveLength(2);
    expect(new Set(wins.map((w) => w.lot_id)).size).toBe(1);

    const msgs = await db.sql<{ status: string; payload: Record<string, unknown> }>(
      `select status, payload from whatsapp_messages where seller_id = $1 order by created_at`,
      [s],
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0].status).toBe("manual_pending");
    expect(msgs[0].payload).toMatchObject({ card_name: "Horsea", card_variant: "Poké Ball Holo", amount_cents: 900, event_number: 15 });
  });

  it("arremates simultâneos do mesmo comprador em eventos diferentes usam um único lote", async () => {
    for (let i = 0; i < 15; i++) {
      const s = await db.seller();
      const adm = await db.user({ role: "admin", sellerId: s });
      const [buyer] = await db.users(1);
      const rounds = await Promise.all(
        [1, 2].map(async (n) => {
          const e = await db.event(s, n);
          const r = await db.round(s, e, { mode: "speed" });
          await db.rpc(adm, "admin_open_round", [r]);
          return r;
        }),
      );
      const results = await Promise.all(rounds.map((r) => db.rpc(buyer, "buy_now", [r, key()])));
      expect(results.map((r) => r.code)).toEqual(["won", "won"]);
      const lots = await db.sql(`select id from lots where user_id = $1`, [buyer]);
      expect(lots).toHaveLength(1);
    }
  });

  it("eventos cancelados não contam para a acumulação", async () => {
    const s = await db.seller();
    const adm = await db.user({ role: "admin", sellerId: s });
    const [buyer] = await db.users(1);
    const e1 = await db.event(s, 1);
    const r1 = await db.round(s, e1, { mode: "speed" });
    await db.rpc(adm, "admin_open_round", [r1]);
    expect((await db.rpc(buyer, "buy_now", [r1, key()])).code).toBe("won");
    await db.event(s, 2, "cancelled");
    const e3 = await db.event(s, 3);
    const r3 = await db.round(s, e3, { mode: "speed" });
    await db.rpc(adm, "admin_open_round", [r3]);
    expect((await db.rpc(buyer, "buy_now", [r3, key()])).code).toBe("won");
  });

  it("modo automático deixa a mensagem pendente para o worker de envio", async () => {
    const s = await db.seller({ whatsapp_mode: "automatic" });
    const adm = await db.user({ role: "admin", sellerId: s });
    const [buyer] = await db.users(1);
    const e = await db.event(s, 1);
    const r = await db.round(s, e, { mode: "speed" });
    await db.rpc(adm, "admin_open_round", [r]);
    await db.rpc(buyer, "buy_now", [r, key()]);
    const [msg] = await db.sql(`select status from whatsapp_messages where round_id = $1`, [r]);
    expect(msg.status).toBe("pending");
  });
});

describe("Sala ao vivo", () => {
  it("transmite só dados públicos a cada mudança, com versão crescente", async () => {
    const { eventId, roundId } = await openRound({ startPrice: 600, increments: [100] });
    const [a] = await Promise.all([db.user({ nickname: "Lia" })]);
    await db.sql(`delete from realtime.sent`);
    await db.rpc(a, "place_bid", [roundId, 600, key()]);
    const sent = await db.sql<{ topic: string; event: string; payload: Record<string, unknown>; private: boolean }>(
      `select topic, event, payload, private from realtime.sent order by id`,
    );
    expect(sent).toHaveLength(1);
    const [m] = sent;
    expect([m.topic, m.event, m.private]).toEqual([`sala:${eventId}`, "round", false]);
    expect(m.payload).toMatchObject({ id: roundId, leading_nickname: "Lia", leading_is_me: false, my_best_bid_cents: null, my_block: "not_authenticated" });
    expect(JSON.stringify(m.payload)).not.toContain(a);

    const before = Number(m.payload.rev);
    await db.rpc(admin, "admin_close_round", [roundId]);
    const [last] = await db.sql<{ payload: { rev: number; status: string } }>(`select payload from realtime.sent order by id desc limit 1`);
    expect(last.payload.status).toBe("closed");
    expect(Number(last.payload.rev)).toBeGreaterThan(before);

    await db.rpc(admin, "admin_finish_event", [eventId]);
    const [ev] = await db.sql<{ event: string; payload: { event_status: string } }>(`select event, payload from realtime.sent order by id desc limit 1`);
    expect([ev.event, ev.payload.event_status]).toEqual(["event", "finished"]);
  });

  it("rodada de evento em rascunho não vai para o canal público", async () => {
    const e = await db.event(seller, 9000 + Math.floor(Math.random() * 90000), "draft");
    await db.sql(`delete from realtime.sent`);
    const r = await db.round(seller, e, { startPrice: 600, increments: [100] });
    await db.sql(`update rounds set start_price_cents = 700 where id = $1`, [r]);
    expect(await db.sql(`select 1 from realtime.sent where topic = $1`, [`sala:${e}`])).toHaveLength(0);
  });

  it("room_state escolhe a rodada e traz o estado pessoal e o status do evento", async () => {
    const { eventId, roundId } = await openRound({ startPrice: 600, increments: [100] });
    const [a] = await Promise.all([db.user({ nickname: "Rui" })]);
    await db.rpc(a, "place_bid", [roundId, 600, key()]);
    const mine = (await db.rpc(a, "room_state", [eventId])) as { event_status: string; state: Record<string, unknown> };
    expect(mine.state).toMatchObject({ id: roundId, leading_is_me: true, my_nickname: "Rui", my_best_bid_cents: 600 });
    expect(mine.event_status).toBe("live");
    const visitor = (await db.rpc(null, "room_state", [eventId])) as { state: Record<string, unknown> };
    expect(visitor.state).toMatchObject({ leading_is_me: false, my_block: "not_authenticated" });

    const draft = await db.event(seller, eventNumber++, "draft");
    expect(await db.rpc(a, "room_state", [draft])).toBeNull();
    expect(await db.rpc(admin, "room_state", [draft])).toMatchObject({ event_status: "draft", state: null });
  });

  it("visitante e usuários não leem o id do líder", async () => {
    const [row] = await db.sql<{ anon: boolean; auth: boolean; nick: boolean }>(
      `select has_column_privilege('anon', 'public.rounds', 'leading_user_id', 'select') anon,
              has_column_privilege('authenticated', 'public.rounds', 'leading_bid_id', 'select') auth,
              has_column_privilege('anon', 'public.rounds', 'leading_nickname', 'select') nick`,
    );
    expect(row).toEqual({ anon: false, auth: false, nick: true });
  });
});
