import { describe, expect, it } from "vitest";
import { cardSummary } from "./card-summary";

describe("cardSummary", () => {
  const base = { tcg: "Pokémon", language: "PT", condition: "NM", collection: "", cardNumber: "" };
  it("mostra o padrão PT e NM sem abrir o Mudar", () => {
    expect(cardSummary(base)).toBe("Português · NM");
  });
  it("inclui coleção, número e jogo quando não é Pokémon", () => {
    expect(cardSummary({ ...base, collection: "151", cardNumber: "025/165" })).toBe("Português · NM · 151 · Nº 025/165");
    expect(cardSummary({ ...base, tcg: "Magic", language: "EN", condition: "LP" })).toBe("Magic · Inglês · LP");
  });
});
