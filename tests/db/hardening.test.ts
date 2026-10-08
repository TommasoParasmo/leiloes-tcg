import { randomUUID } from "node:crypto";
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

const signUp = (m: Record<string, unknown>) =>
  db.sql(`insert into auth.users (email, raw_user_meta_data) values ($1, $2)`, [`${randomUUID()}@t.dev`, m]);
const meta = (o: Record<string, unknown>) => ({
  full_name: "Xavier Teste",
  nickname: `x${randomUUID().slice(0, 6)}`,
  whatsapp: "11977770001",
  address: { cep: "01310100", street: "Av. Paulista", number: "1", district: "Bela Vista", city: "São Paulo", state: "SP" },
  terms_version: "2026-10-08",
  ...o,
});

describe("cadastro único (revisão do PR)", () => {
  it("mesmo WhatsApp com ou sem 55 é o mesmo número", async () => {
    await signUp(meta({ whatsapp: "21 98888-0001" }));
    await expect(signUp(meta({ whatsapp: "+55 (21) 98888-0001" }))).rejects.toThrow(/profiles_whatsapp_unique/);
    const free = (w: string) => db.as(null, async (c) => (await c.query(`select public.whatsapp_available($1) ok`, [w])).rows[0].ok);
    expect(await free("5521988880001")).toBe(false);
    expect(await free("21988880002")).toBe(true);
  });

  it("CPF inválido enviado direto pela API não entra", async () => {
    await expect(signUp(meta({ whatsapp: "11977770011", cpf: "123.456.789-00" }))).rejects.toThrow(/profiles_cpf_valid/);
  });

  it("ninguém cria a própria linha de perfil (CPF falso, admin de loja)", async () => {
    const id = randomUUID();
    await db.sql(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@t.dev`]);
    await expect(
      db.as(id, (c) =>
        c.query(`insert into profiles (id, full_name, nickname, whatsapp, cpf, role, status, admin_seller_id) values ($1, 'Yago', $2, '11977770002', '00000000000', 'buyer', 'active', $3)`, [
          id,
          `y${id.slice(0, 6)}`,
          seller,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("comprador continua editando o próprio apelido (a checagem de CPF roda com o papel dele)", async () => {
    const [u] = await db.users(1);
    await db.as(u, (c) => c.query(`update profiles set nickname = $2 where id = $1`, [u, `novo${u.slice(0, 6)}`]));
  });
});

describe("comprovante recusado depois do prazo", () => {
  it("dá 24h para reenviar e não gera cartão na hora", async () => {
    const [b] = await db.users(1);
    await db.sql(
      `insert into addresses (user_id, cep, street, number, district, city, state, is_default)
       values ($1, '01310100', 'Av. Paulista', '1578', 'Bela Vista', 'São Paulo', 'SP', true)`,
      [b],
    );
    const e = await db.event(seller, number++);
    const r = await db.round(seller, e, { mode: "speed", fixedPrice: 1200 });
    await db.rpc(admin, "admin_open_round", [r]);
    expect((await db.rpc(b, "buy_now", [r, key()])).code).toBe("won");
    await db.rpc(admin, "admin_finish_event", [e]);
    const [lot] = await db.sql<{ id: string }>(`select id from lots where user_id = $1`, [b]);
    await db.rpc(b, "close_my_lot", [lot.id]);
    const [o] = await db.sql<{ id: string }>(`select id from orders where user_id = $1`, [b]);
    await db.rpc(admin, "admin_quote_shipping", [o.id, 2500, "PAC", 5]);
    expect((await db.rpc(b, "submit_payment_proof", [o.id, `${b}/${o.id}/c.jpg`])).code).toBe("proof_sent");
    await db.sql(`update orders set due_at = now() - interval '1 minute' where id = $1`, [o.id]);

    expect((await db.rpc(admin, "admin_reject_payment", [o.id, "Comprovante ilegível"])).code).toBe("rejected");
    await db.sql(`select public.app_process_lots()`);
    const [{ n }] = await db.sql<{ n: string }>(`select count(*) n from penalties where user_id = $1`, [b]);
    expect(Number(n)).toBe(0);
    const [d] = await db.sql<{ ok: boolean; pay_ok: boolean }>(
      `select o.due_at > now() + interval '23 hours' ok,
              (select bool_and(p.due_at = o.due_at) from payments p where p.order_id = o.id and p.status = 'pending') pay_ok
         from orders o where o.id = $1`,
      [o.id],
    );
    expect(d).toEqual({ ok: true, pay_ok: true });
  });
});
