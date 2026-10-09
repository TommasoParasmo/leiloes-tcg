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

/** Pedido pago de um comprador com endereço, cotado com `service`. */
async function paidOrder(service = "SEDEX", price = 1500) {
  const [buyer] = await db.users(1);
  await db.sql(
    `insert into addresses (user_id, cep, street, number, complement, district, city, state, is_default)
     values ($1, '01310100', 'Av. Paulista', '1578', 'ap 12', 'Bela Vista', 'São Paulo', 'SP', true)`,
    [buyer],
  );
  const e = await db.event(seller, number++);
  const r = await db.round(seller, e, { mode: "speed", fixedPrice: price });
  await db.rpc(admin, "admin_open_round", [r]);
  expect((await db.rpc(buyer, "buy_now", [r, key()])).code).toBe("won");
  await db.rpc(admin, "admin_finish_event", [e]);
  const [lot] = await db.sql<{ id: string }>(`select id from lots where user_id = $1`, [buyer]);
  const { order_id: orderId } = (await db.rpc(admin, "admin_close_lot", [lot.id])) as { order_id: string };
  await db.rpc(admin, "admin_quote_shipping", [orderId, 2200, service, 3]);
  return { buyer, orderId };
}

const sender = ["Loja Teste", "Rua Funchal", "418", "sala 3", "Vila Olímpia", "São Paulo", "sp"];

describe("remetente da etiqueta", () => {
  it("só o leiloeiro salva; UF vira maiúscula; campos ruins são recusados; o comprador não vê", async () => {
    const [buyer] = await db.users(1);
    expect((await db.rpc(buyer, "admin_update_sender", sender)).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_update_sender", ["Loja", "Rua", "1", "", "Bairro", "Cidade", "São"])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_sender", ["L", "Rua X", "1", "", "Bairro", "Cidade", "SP"])).code).toBe("invalid_request");
    expect((await db.rpc(admin, "admin_update_sender", sender)).code).toBe("saved");
    const [p] = await db.sql<{ sender_state: string; sender_complement: string }>(
      `select sender_state, sender_complement from seller_private where seller_id = $1`,
      [seller],
    );
    expect(p).toEqual({ sender_state: "SP", sender_complement: "sala 3" });
    expect(await db.as(buyer, async (c) => (await c.query(`select sender_street from seller_private`)).rows)).toEqual([]);
  });

  it("salvar o Pix e o CEP não apaga o remetente, e vice-versa", async () => {
    await db.rpc(admin, "admin_update_sender", sender);
    await db.rpc(admin, "admin_update_store", ["pix@loja.com", "Loja Teste", "Sao Paulo", "04538133", ""]);
    await db.rpc(admin, "admin_update_sender", sender);
    const [p] = await db.sql<{ origin_cep: string; sender_name: string }>(`select origin_cep, sender_name from seller_private where seller_id = $1`, [seller]);
    expect(p).toEqual({ origin_cep: "04538133", sender_name: "Loja Teste" });
  });
});

describe("etiqueta do SuperFrete", () => {
  it("dados da etiqueta: só pedido pago, só com remetente, com nome e CPF do comprador e as cartas", async () => {
    await db.rpc(admin, "admin_update_store", ["pix@loja.com", "Loja Teste", "Sao Paulo", "04538133", ""]);
    await db.rpc(admin, "admin_update_sender", ["", "", "", "", "", "", ""]);
    const { buyer, orderId } = await paidOrder();
    expect((await db.rpc(admin, "admin_label_input", [orderId])).code).toBe("order_wrong_status");
    await db.rpc(admin, "admin_confirm_payment", [orderId]);
    expect((await db.rpc(buyer, "admin_label_input", [orderId])).code).toBe("forbidden");
    expect((await db.rpc(admin, "admin_label_input", [orderId])).code).toBe("sender_required");

    await db.rpc(admin, "admin_update_sender", sender);
    const input = await db.rpc(admin, "admin_label_input", [orderId]);
    const [b] = await db.sql<{ full_name: string; cpf: string }>(`select full_name, cpf from profiles where id = $1`, [buyer]);
    expect(input).toMatchObject({
      ok: true,
      from: { name: "Loja Teste", address: "Rua Funchal", number: "418", district: "Vila Olímpia", state_abbr: "SP", postal_code: "04538133" },
      to: { name: b.full_name, document: b.cpf, address: "Av. Paulista", number: "1578", complement: "ap 12", city: "São Paulo", state_abbr: "SP", postal_code: "01310100" },
      service_name: "SEDEX",
      items: [{ amount_cents: 1500 }],
      label: null,
    });
  });

  it("guarda a etiqueta; não troca por outra enquanto a primeira vale; cancelada pode ser trocada", async () => {
    await db.rpc(admin, "admin_update_store", ["pix@loja.com", "Loja Teste", "Sao Paulo", "04538133", ""]);
    await db.rpc(admin, "admin_update_sender", sender);
    const { buyer, orderId } = await paidOrder("PAC");
    await db.rpc(admin, "admin_confirm_payment", [orderId]);
    const save = (u: string, id: string, status: string, url: string | null = null, tracking: string | null = null) =>
      db.rpc(u, "admin_save_label", [orderId, id, status, url, tracking]);

    expect((await save(buyer, "SF1", "pending")).code).toBe("forbidden");
    expect((await save(admin, "id com espaço", "pending")).code).toBe("invalid_request");
    expect((await save(admin, "SF1", "released", "http://inseguro.example/x.pdf")).code).toBe("invalid_request");
    expect((await save(admin, "SF1", "pending")).code).toBe("saved");
    expect((await save(admin, "SF2", "pending")).code).toBe("label_exists");

    expect((await save(admin, "SF1", "released", "https://superfrete.com/_etiqueta/pdf/abc", "ec 451638075 br")).code).toBe("saved");
    // atualizar de novo sem link não apaga o link nem o rastreio
    expect((await save(admin, "SF1", "posted")).code).toBe("saved");
    const [l] = await db.sql<{ status: string; label_url: string; tracking_code: string }>(
      `select status, label_url, tracking_code from order_labels where order_id = $1`,
      [orderId],
    );
    expect(l).toEqual({ status: "posted", label_url: "https://superfrete.com/_etiqueta/pdf/abc", tracking_code: "EC451638075BR" });
    expect((await db.rpc(admin, "admin_label_input", [orderId])).label).toEqual({ superfrete_order_id: "SF1", status: "posted" });

    // o comprador não vê a etiqueta (tem o endereço de quem envia)
    expect(await db.as(buyer, async (c) => (await c.query(`select * from order_labels`)).rows)).toEqual([]);
    await expect(db.as(buyer, (c) => c.query(`insert into order_labels (order_id, seller_id, superfrete_order_id) values ($1, $2, 'X')`, [orderId, seller]))).rejects.toThrow(
      /permission denied/,
    );

    await save(admin, "SF1", "canceled");
    expect((await save(admin, "SF2", "pending")).code).toBe("saved");
    const [n] = await db.sql<{ superfrete_order_id: string; label_url: string | null; tracking_code: string | null }>(
      `select superfrete_order_id, label_url, tracking_code from order_labels where order_id = $1`,
      [orderId],
    );
    expect(n).toEqual({ superfrete_order_id: "SF2", label_url: null, tracking_code: null });
  });
});
