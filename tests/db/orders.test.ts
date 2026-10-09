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

async function buyerWithAddress() {
  const [u] = await db.users(1);
  await db.sql(
    `insert into addresses (user_id, cep, street, number, district, city, state, is_default)
     values ($1, '01310100', 'Av. Paulista', '1578', 'Bela Vista', 'São Paulo', 'SP', true)`,
    [u],
  );
  return u;
}

/** Evento com uma rodada de rapidez arrematada por `buyer` (ou sem arremate) e encerrado. */
async function auction(buyer: string | null, price = 1200) {
  const e = await db.event(seller, number++);
  const r = await db.round(seller, e, { mode: "speed", fixedPrice: price });
  await db.rpc(admin, "admin_open_round", [r]);
  if (buyer) expect((await db.rpc(buyer, "buy_now", [r, key()])).code).toBe("won");
  else await db.rpc(admin, "admin_close_round", [r]);
  expect((await db.rpc(admin, "admin_finish_event", [e])).code).toBe("finished");
  return e;
}

const lotOf = async (user: string) =>
  (await db.sql<{ id: string; status: string }>(`select id, status from lots where user_id = $1 and seller_id = $2 order by created_at desc`, [user, seller]))[0];
const orderOf = async (user: string) =>
  (await db.sql<{ id: string; status: string; subtotal_cents: string; due_at: Date; total_cents: string }>(
    `select id, status, subtotal_cents, due_at, total_cents from orders where user_id = $1 order by created_at desc`,
    [user],
  ))[0];
const runLots = () => db.sql(`select public.app_process_lots()`);
const activePenalties = async (user: string) =>
  Number((await db.sql<{ n: string }>(`select count(*) n from penalties where user_id = $1 and removed_at is null`, [user]))[0].n);

describe("lote e prazo do Pix", () => {
  it("1 leilão: 7 dias desde o fim; 2º leilão: lote fecha sozinho e vence 24h depois", async () => {
    const buyer = await buyerWithAddress();
    const e1 = await auction(buyer);
    const [{ due }] = await db.sql<{ due: Date }>(`select public.app_lot_due_at(l) due from lots l where user_id = $1`, [buyer]);
    const [{ fin }] = await db.sql<{ fin: Date }>(`select finished_at fin from events where id = $1`, [e1]);
    expect(due.getTime() - fin.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect((await lotOf(buyer)).status).toBe("open");

    // evento criado e abandonado no meio não conta para a acumulação
    await db.event(seller, number++, "scheduled");
    const e2 = await auction(null);
    expect((await lotOf(buyer)).status).toBe("closed");
    const order = await orderOf(buyer);
    const [{ fin2 }] = await db.sql<{ fin2: Date }>(`select finished_at fin2 from events where id = $1`, [e2]);
    expect(order.status).toBe("awaiting_shipping_quote");
    expect(order.due_at.getTime() - fin2.getTime()).toBe(24 * 3600 * 1000);

    // lote fechado: volta a participar no próximo evento
    const e3 = await db.event(seller, number++);
    const r = await db.round(seller, e3);
    await db.rpc(admin, "admin_open_round", [r]);
    expect((await db.rpc(buyer, "place_bid", [r, 600, key()])).code).toBe("leading");
  });

  it("comprador fecha o próprio lote e o pedido sai com o total das cartas", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer, 1500);
    const lot = await lotOf(buyer);
    const [stranger] = await db.users(1);
    expect((await db.rpc(stranger, "close_my_lot", [lot.id])).code).toBe("lot_not_found");
    const res = await db.rpc(buyer, "close_my_lot", [lot.id]);
    expect(res.code).toBe("lot_closed");
    expect((await db.rpc(buyer, "close_my_lot", [lot.id])).code).toBe("lot_already_closed");
    const order = await orderOf(buyer);
    expect([order.id, order.status, Number(order.subtotal_cents)]).toEqual([res.order_id, "awaiting_shipping_quote", 1500]);
    const [w] = await db.sql<{ status: string }>(`select status from wins where user_id = $1`, [buyer]);
    expect(w.status).toBe("in_order");
  });

  it("sem endereço não fecha (o frete precisa de destino)", async () => {
    const [buyer] = await db.users(1);
    await auction(buyer);
    expect((await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])).code).toBe("address_required");
  });
});

describe("frete, Pix e confirmação", () => {
  it("frete libera o Pix, comprovante vai para o leiloeiro, que confirma ou recusa", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer, 2000);
    const { order_id: orderId } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };

    expect((await db.rpc(buyer, "admin_quote_shipping", [orderId, 2500, "PAC", 6])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_quote_shipping", [orderId, -1, "PAC", 6])).code).toBe("invalid_request");
    const q = await db.rpc(admin, "admin_quote_shipping", [orderId, 2500, "PAC", 6]);
    expect(q).toMatchObject({ code: "quoted", total_cents: 4500 });
    const [pay] = await db.sql<{ amount_cents: string; status: string }>(`select amount_cents, status from payments where order_id = $1`, [orderId]);
    expect([Number(pay.amount_cents), pay.status]).toEqual([4500, "pending"]);
    // chave Pix só para quem tem o pedido
    await db.sql(`update sellers set pix_key = 'pix@loja.com' where id = $1`, [seller]);
    expect((await db.rpc(buyer, "order_pix", [orderId]))).toMatchObject({ pix_key: "pix@loja.com" });
    const [stranger] = await db.users(1);
    expect(await db.rpc(stranger, "order_pix", [orderId])).toBeNull();

    // comprovante só no caminho do próprio pedido
    expect((await db.rpc(buyer, "submit_payment_proof", [orderId, `${stranger}/${orderId}/a.jpg`])).code).toBe("invalid_request");
    expect((await db.rpc(buyer, "submit_payment_proof", [orderId, `${buyer}/${orderId}/a.jpg`])).code).toBe("proof_sent");

    expect((await db.rpc(admin, "admin_reject_payment", [orderId, ""])).code).toBe("reason_required");
    expect((await db.rpc(admin, "admin_reject_payment", [orderId, "Valor diferente do total"])).code).toBe("rejected");
    expect((await orderOf(buyer)).status).toBe("awaiting_payment");
    const pays = await db.sql<{ status: string }>(`select status from payments where order_id = $1 order by created_at`, [orderId]);
    expect(pays.map((p) => p.status)).toEqual(["rejected", "pending"]);

    expect((await db.rpc(buyer, "submit_payment_proof", [orderId, `${buyer}/${orderId}/b.jpg`])).code).toBe("proof_sent");
    expect((await db.rpc(admin, "admin_confirm_payment", [orderId])).code).toBe("confirmed");
    expect((await orderOf(buyer)).status).toBe("paid");
    const [w] = await db.sql<{ status: string }>(`select status from wins where user_id = $1`, [buyer]);
    expect(w.status).toBe("paid");
    expect((await db.rpc(admin, "admin_confirm_payment", [orderId])).code).toBe("order_wrong_status");
  });

  it("frete cotado em cima da hora ainda dá 24h para pagar", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer);
    const { order_id: orderId } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };
    await db.sql(`update orders set due_at = now() - interval '1 hour' where id = $1`, [orderId]);
    await runLots(); // aguardando frete: atraso é do leiloeiro, sem cartão
    expect(await activePenalties(buyer)).toBe(0);
    await db.rpc(admin, "admin_quote_shipping", [orderId, 1000, "PAC", null]);
    const [{ h }] = await db.sql<{ h: number }>(`select extract(epoch from due_at - now()) / 3600 h from orders where id = $1`, [orderId]);
    expect(Number(h)).toBeGreaterThan(23.9);
  });
});

describe("cartão amarelo e bloqueio", () => {
  it("um cartão por pedido vencido; o 2º bloqueia; só admin desbloqueia com justificativa", async () => {
    const buyer = await buyerWithAddress();
    const order = async () => {
      await auction(buyer);
      const { order_id: id } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };
      await db.rpc(admin, "admin_quote_shipping", [id, 1000, "PAC", null]);
      await db.sql(`update orders set due_at = now() - interval '1 minute' where id = $1`, [id]);
      return id;
    };

    const o1 = await order();
    await runLots();
    await runLots();
    expect(await activePenalties(buyer)).toBe(1);
    // comprovante recusado e novo pagamento no mesmo pedido não geram outro cartão
    await db.rpc(buyer, "submit_payment_proof", [o1, `${buyer}/${o1}/x.jpg`]);
    await db.rpc(admin, "admin_reject_payment", [o1, "Comprovante ilegível"]);
    await runLots();
    expect(await activePenalties(buyer)).toBe(1);

    await order();
    await runLots();
    expect(await activePenalties(buyer)).toBe(2);
    const [p] = await db.sql<{ status: string }>(`select status from profiles where id = $1`, [buyer]);
    expect(p.status).toBe("blocked");

    const e = await db.event(seller, number++);
    const r = await db.round(seller, e);
    await db.rpc(admin, "admin_open_round", [r]);
    expect((await db.rpc(buyer, "place_bid", [r, 600, key()])).code).toBe("blocked");

    expect((await db.rpc(buyer, "admin_unblock_user", [buyer, "Pagou tudo"])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_unblock_user", [buyer, ""])).code).toBe("justification_required");
    expect((await db.rpc(admin, "admin_unblock_user", [buyer, "Pagou os dois pedidos por fora"])).code).toBe("unblocked");
    expect((await db.rpc(buyer, "place_bid", [r, 600, key()])).code).toBe("leading");

    const [pen] = await db.sql<{ id: string }>(`select id from penalties where user_id = $1 limit 1`, [buyer]);
    expect((await db.rpc(admin, "admin_remove_penalty", [pen.id, "ok"])).code).toBe("justification_required");
    expect((await db.rpc(admin, "admin_remove_penalty", [pen.id, "Atraso do banco confirmado"])).code).toBe("removed");
    expect(await activePenalties(buyer)).toBe(1);
  });

  it("cancelar pedido devolve as cartas para novos eventos", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer);
    const { order_id: id } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };
    expect((await db.rpc(admin, "admin_cancel_order", [id, "Desistência combinada"])).code).toBe("cancelled");
    const [{ card_id }] = await db.sql<{ card_id: string }>(`select card_id from wins where user_id = $1`, [buyer]);
    const e = await db.event(seller, number++);
    expect((await db.rpc(admin, "admin_add_round", [e, card_id, "speed", null, null, null, 900, "manual", null])).code).toBe("created");
  });
});

describe("painel: lote, envio e WhatsApp", () => {
  it("leiloeiro não fecha lote de quem não tem endereço", async () => {
    const [buyer] = await db.users(1);
    await auction(buyer, 1000);
    const lot = await lotOf(buyer);
    expect((await db.rpc(admin, "admin_close_lot", [lot.id])).code).toBe("address_required");
    expect((await lotOf(buyer)).status).toBe("open");
  });

  it("leiloeiro fecha o lote do comprador, registra envio e entrega", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer, 1000);
    const lot = await lotOf(buyer);
    expect((await db.rpc(buyer, "admin_close_lot", [lot.id])).code).toBe("forbidden");
    const res = await db.rpc(admin, "admin_close_lot", [lot.id]);
    expect(res.code).toBe("lot_closed");
    expect((await db.rpc(admin, "admin_close_lot", [lot.id])).code).toBe("lot_already_closed");
    const orderId = res.order_id as string;

    expect((await db.rpc(admin, "admin_ship_order", [orderId, "AB123456789BR"])).code).toBe("order_wrong_status");
    await db.rpc(admin, "admin_quote_shipping", [orderId, 500, "PAC", 5]);
    await db.rpc(admin, "admin_confirm_payment", [orderId]);
    expect((await db.rpc(admin, "admin_ship_order", [orderId, " "])).code).toBe("tracking_required");
    expect((await db.rpc(admin, "admin_ship_order", [orderId, "ab 123456789 br"])).code).toBe("shipped");
    const [s] = await db.sql<{ tracking_code: string; status: string }>(`select tracking_code, status from shipments where order_id = $1`, [orderId]);
    expect(s).toEqual({ tracking_code: "AB123456789BR", status: "posted" });
    const [w] = await db.sql<{ status: string }>(`select status from wins where user_id = $1`, [buyer]);
    expect(w.status).toBe("shipped");
    const notes = await db.sql<{ kind: string }>(`select kind from notifications where user_id = $1`, [buyer]);
    expect(notes.map((n) => n.kind)).toContain("order_shipped");

    expect((await db.rpc(admin, "admin_mark_delivered", [orderId])).code).toBe("delivered");
    expect((await orderOf(buyer)).status).toBe("delivered");
  });

  it("rodada sem lances gera mensagem; erro volta para a fila; mensagem pode ser descartada", async () => {
    const e = await db.event(seller, number++);
    const r = await db.round(seller, e);
    await db.rpc(admin, "admin_open_round", [r]);
    await db.rpc(admin, "admin_close_round", [r]);
    const [m] = await db.sql<{ id: string; status: string; payload: { winner_nickname: string | null } }>(
      `select id, status, payload from whatsapp_messages where round_id = $1`,
      [r],
    );
    expect([m.status, m.payload.winner_nickname]).toEqual(["manual_pending", null]);

    expect((await db.rpc(admin, "admin_whatsapp_requeue", [m.id])).code).toBe("message_already_done");
    await db.rpc(admin, "admin_whatsapp_mark", [m.id, false, "Grupo fora do ar"]);
    expect((await db.rpc(admin, "admin_whatsapp_requeue", [m.id])).code).toBe("requeued");
    expect((await db.sql<{ status: string }>(`select status from whatsapp_messages where id = $1`, [m.id]))[0].status).toBe("manual_pending");
    expect((await db.rpc(admin, "admin_whatsapp_dismiss", [m.id])).code).toBe("dismissed");
    expect((await db.rpc(admin, "admin_whatsapp_dismiss", [m.id])).code).toBe("message_already_done");
  });

  it("status e número do evento não mudam direto pela tabela", async () => {
    const e = await db.event(seller, number++);
    const err = await db.as(admin, (c) => c.query(`update events set status = 'finished', number = 999 where id = $1`, [e])).catch((x: Error) => x);
    expect(err).toBeInstanceOf(Error);
    const [row] = await db.sql<{ status: string; number: number }>(`select status, number from events where id = $1`, [e]);
    expect(row.status).toBe("scheduled");
  });
});

describe("avisos", () => {
  it("avisa uma vez quando o Pix está para vencer", async () => {
    const buyer = await buyerWithAddress();
    await auction(buyer);
    const { order_id: id } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };
    await db.rpc(admin, "admin_quote_shipping", [id, 1000, "PAC", null]);
    const due = () => db.sql(`select public.app_remind_due_payments()`);
    await db.sql(`update orders set due_at = now() + interval '2 days' where id = $1`, [id]);
    await due();
    await db.sql(`update orders set due_at = now() + interval '3 hours' where id = $1`, [id]);
    await due();
    await due();
    const notes = await db.sql<{ body: string }>(`select body from notifications where user_id = $1 and kind = 'payment_due_soon'`, [buyer]);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("R$ 22,00");
  });
});

describe("minha loja e dados do frete", () => {
  it("leiloeiro salva Pix e CEP de origem; o CEP não fica público", async () => {
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_update_store", ["x", "y", "z", "01310100"])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_update_store", ["k", "n", "c", "0131"])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_store", [" pix@loja.com ", "Loja Teste", "Sao Paulo", "01310-100"])).code).toBe("saved");
    const [s] = await db.sql<{ pix_key: string; origin_cep: string }>(
      `select s.pix_key, p.origin_cep from sellers s join seller_private p on p.seller_id = s.id where s.id = $1`,
      [seller],
    );
    expect(s).toEqual({ pix_key: "pix@loja.com", origin_cep: "01310100" });
    const seen = await db.as(buyer, async (c) => (await c.query(`select * from seller_private`)).rows);
    expect(seen).toEqual([]);
    await expect(db.as(null, (c) => c.query(`select * from seller_private`))).rejects.toThrow(/permission denied/);
  });

  it("dados para cotar: CEP de origem, CEP do comprador e número de cartas, só para o leiloeiro", async () => {
    await db.rpc(admin, "admin_update_store", ["pix@loja.com", "Loja Teste", "Sao Paulo", "04538133"]);
    const buyer = await buyerWithAddress();
    await auction(buyer, 1500);
    const { order_id: orderId } = (await db.rpc(buyer, "close_my_lot", [(await lotOf(buyer)).id])) as { order_id: string };
    expect((await db.rpc(buyer, "admin_shipping_quote_input", [orderId])).code).toBe("forbidden");
    expect(await db.rpc(admin, "admin_shipping_quote_input", [orderId])).toMatchObject({ ok: true, from_cep: "04538133", to_cep: "01310100", cards: 1 });
  });
});
