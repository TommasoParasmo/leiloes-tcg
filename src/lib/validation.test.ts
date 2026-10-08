import { describe, expect, it } from "vitest";
import * as v from "./validation";

describe("validação do cadastro", () => {
  it("WhatsApp com DDD", () => {
    expect(v.validateWhatsapp("(11) 98765-4321")).toBeNull();
    expect(v.validateWhatsapp("98765-4321")).not.toBeNull();
    expect(v.formatWhatsapp("11987654321")).toBe("(11) 98765-4321");
    expect(v.formatWhatsapp("1134567890")).toBe("(11) 3456-7890");
  });
  it("CEP", () => {
    expect(v.validateCep("01310-100")).toBeNull();
    expect(v.validateCep("0131")).not.toBeNull();
    expect(v.formatCep("01310100")).toBe("01310-100");
  });
  it("senha, e-mail e apelido", () => {
    expect(v.validatePassword("abc12345")).toBeNull();
    expect(v.validatePassword("abcdefgh")).not.toBeNull();
    expect(v.validatePassword("abc1")).not.toBeNull();
    expect(v.validateEmail("joao@exemplo.com")).toBeNull();
    expect(v.validateEmail("joao@")).not.toBeNull();
    expect(v.validateNickname(" J ")).not.toBeNull();
    expect(v.validateNickname("João")).toBeNull();
  });
  it("lê a resposta do ViaCEP", () => {
    expect(v.parseViaCep({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" })).toEqual({
      street: "Avenida Paulista",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(v.parseViaCep({ erro: "true" })).toBeNull();
  });
});

describe("CPF", () => {
  it("aceita CPF válido com ou sem pontuação e recusa dígitos errados", () => {
    const { validateCpf, formatCpf } = v;
    expect(validateCpf("529.982.247-25")).toBeNull();
    expect(validateCpf("52998224726")).toMatch(/inválido/);
    expect(validateCpf("111.111.111-11")).toMatch(/inválido/);
    expect(validateCpf("123")).toMatch(/11 números/);
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });
});
