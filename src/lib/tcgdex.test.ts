import { describe, expect, it } from "vitest";
import { parseHits, parsePick, tcgdexLang } from "./tcgdex";

describe("tcgdex", () => {
  it("escolhe o idioma da busca pelo idioma da carta", () => {
    expect(tcgdexLang("PT")).toBe("pt");
    expect(tcgdexLang("JP")).toBe("ja");
    expect(tcgdexLang("EN")).toBe("en");
    expect(tcgdexLang("Outro")).toBe("en");
  });

  it("lê a lista de cartas e ignora itens quebrados", () => {
    const hits = parseHits([
      { id: "sv03.5-146", localId: "146", name: "Moltres", image: "https://assets.tcgdex.net/pt/sv/sv03.5/146" },
      { id: "x", name: 3 },
      { id: "base3-12", localId: 12, name: "Moltres" },
    ]);
    expect(hits).toEqual([
      { id: "sv03.5-146", name: "Moltres", localId: "146", image: "https://assets.tcgdex.net/pt/sv/sv03.5/146/low.webp" },
      { id: "base3-12", name: "Moltres", localId: "12", image: null },
    ]);
    expect(parseHits({ error: "x" })).toEqual([]);
  });

  it("monta número/total com zeros como na carta", () => {
    expect(parsePick({ name: "Moltres", localId: "12", set: { name: "Fóssil", cardCount: { official: 62 } } })).toEqual({ name: "Moltres", collection: "Fóssil", cardNumber: "12/62" });
    expect(parsePick({ name: "Moltres", localId: "7", set: { name: "X", cardCount: { official: 165 } } })?.cardNumber).toBe("007/165");
    expect(parsePick({ name: "Moltres", localId: "SWSH001", set: { name: "Promos" } })?.cardNumber).toBe("SWSH001");
    expect(parsePick(null)).toBeNull();
  });
});
