import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "./money";

describe("money", () => {
  it("formata centavos em reais", () => {
    expect(formatBRL(900)).toBe("R$ 9,00");
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL("1050")).toBe("R$ 10,50");
  });
  it("recusa valores não inteiros", () => {
    expect(() => formatBRL(9.5)).toThrow();
  });
  it("lê valores digitados", () => {
    expect(parseBRL("9")).toBe(900);
    expect(parseBRL("R$ 9,5")).toBe(950);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("9,999")).toBeNull();
  });
});
