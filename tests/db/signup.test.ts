import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => db?.destroy());

const meta = (overrides: Record<string, unknown> = {}) => ({
  full_name: "João Pereira",
  nickname: `Joao${randomUUID().slice(0, 4)}`,
  whatsapp: "(11) 98765-4321",
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
    const m = meta();
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

  it("ninguém se cadastra como admin pelo formulário", async () => {
    const [u] = await signUp(meta({ role: "admin" }));
    const [p] = await db.sql(`select role from profiles where id = $1`, [u.id]);
    expect(p.role).toBe("buyer");
  });
});
