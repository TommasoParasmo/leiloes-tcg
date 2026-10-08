import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => db?.destroy());

let phone = 0;
const meta = (overrides: Record<string, unknown> = {}) => ({
  full_name: "João Pereira",
  nickname: `Joao${randomUUID().slice(0, 4)}`,
  whatsapp: `(11) 98765-${String(4000 + phone++)}`,
  address: {
    cep: "01310-100",
    street: "Av. Paulista",
    number: "1578",
    complement: "",
    district: "Bela Vista",
    city: "São Paulo",
    state: "sp",
  },
  ...overrides,
});

const signUp = (m: Record<string, unknown>) =>
  db.sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${randomUUID()}@t.dev`, m]);

describe("cadastro", () => {
  it("cria perfil e endereço padrão a partir dos dados do formulário", async () => {
    const m = meta({ whatsapp: "(11) 98765-4321" });
    const [u] = await signUp(m);
    const [p] = await db.sql(`select nickname, whatsapp, role, status from profiles where id = $1`, [u.id]);
    expect(p).toEqual({ nickname: m.nickname, whatsapp: "11987654321", role: "buyer", status: "active" });
    const [a] = await db.sql(`select cep, state, complement, is_default from addresses where user_id = $1`, [u.id]);
    expect(a).toEqual({ cep: "01310100", state: "SP", complement: null, is_default: true });
  });

  it("dados inválidos abortam o cadastro inteiro", async () => {
    await expect(signUp(meta({ whatsapp: "123" }))).rejects.toThrow(/whatsapp/);
    await expect(signUp(meta({ address: { ...meta().address, cep: "123" } }))).rejects.toThrow(/cep/);
  });

  it("não aceita apelido repetido e informa disponibilidade", async () => {
    const m = meta();
    await signUp(m);
    await expect(signUp(meta({ nickname: m.nickname.toUpperCase() }))).rejects.toThrow(/profiles_nickname_key/);
    expect((await db.as(null, (c) => c.query(`select public.nickname_available($1) as ok`, [m.nickname]))).rows[0].ok).toBe(false);
    expect((await db.as(null, (c) => c.query(`select public.nickname_available('Livre123') as ok`))).rows[0].ok).toBe(true);
  });

  it("WhatsApp e CPF não se repetem entre contas (bloqueado não volta com outro e-mail)", async () => {
    await signUp(meta({ whatsapp: "+55 (21) 99999-0001", cpf: "529.982.247-25" }));
    expect((await db.as(null, (c) => c.query(`select public.whatsapp_available('5521999990001') as ok`))).rows[0].ok).toBe(false);
    expect((await db.as(null, (c) => c.query(`select public.whatsapp_available('21 99999-0002') as ok`))).rows[0].ok).toBe(true);
    await expect(signUp(meta({ whatsapp: "5521999990001" }))).rejects.toThrow(/profiles_whatsapp_unique/);
    await expect(signUp(meta({ cpf: "52998224725" }))).rejects.toThrow(/profiles_cpf_unique/);
  });

  it("CPF é validado e exigido antes do primeiro lance", async () => {
    const seller = await db.seller();
    const e = await db.event(seller, 1);
    const r = await db.round(seller, e);
    const admin = await db.user({ role: "admin", sellerId: seller });
    await db.rpc(admin, "admin_open_round", [r]);
    const buyer = await db.user({ cpf: null });
    expect((await db.rpc(buyer, "place_bid", [r, 600, "chave-cpf-1"])).code).toBe("cpf_required");
    expect((await db.rpc(buyer, "complete_profile", ["111.111.111-11"])).code).toBe("invalid_cpf");
    expect((await db.rpc(buyer, "complete_profile", ["529.982.247-26"])).code).toBe("invalid_cpf");
    const other = await db.user();
    const [{ cpf }] = await db.sql<{ cpf: string }>(`select cpf from profiles where id = $1`, [other]);
    expect((await db.rpc(buyer, "complete_profile", [cpf])).code).toBe("cpf_taken");
    expect((await db.rpc(buyer, "complete_profile", ["390.533.447-05"])).code).toBe("saved");
    expect((await db.rpc(buyer, "complete_profile", ["390.533.447-05"])).code).toBe("cpf_already_set");
    expect((await db.rpc(buyer, "place_bid", [r, 600, "chave-cpf-2"])).code).toBe("leading");
  });

  it("ninguém se cadastra como admin pelo formulário", async () => {
    const [u] = await signUp(meta({ role: "admin" }));
    const [p] = await db.sql(`select role from profiles where id = $1`, [u.id]);
    expect(p.role).toBe("buyer");
  });
});
