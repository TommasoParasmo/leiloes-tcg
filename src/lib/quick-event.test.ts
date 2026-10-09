import { describe, expect, it } from "vitest";
import { dayChips, defaultSlot, defaultsSummary, eventTitle, isPast, parseIncrements, startsAtIso } from "./quick-event";

describe("criar leilão", () => {
  it("dias: hoje e amanhã no horário de Brasília, depois o dia da semana", () => {
    // 01h UTC do dia 10 ainda é dia 9 (sexta) em Brasília
    const chips = dayChips(new Date("2026-10-10T01:00:00Z"));
    expect(chips.map((c) => c.label)).toEqual(["Hoje 09/10", "Amanhã 10/10", "Domingo 11/10", "Segunda 12/10"]);
    expect(chips[0].date).toBe("2026-10-09");
  });

  it("título automático e horário de Brasília em UTC", () => {
    expect(eventTitle("2026-10-10")).toBe("Sábado, 10/10");
    expect(startsAtIso("2026-10-10", "20:00")).toBe("2026-10-10T23:00:00.000Z");
    expect(startsAtIso("2026-10-10", "")).toBeNull();
  });

  it("resumo do lance padrão e leitura dos botões", () => {
    expect(defaultsSummary({ startCents: 500, incrementsCents: [100, 200, 500], seconds: 20 })).toBe(
      "Todas com lance inicial de R$ 5, botões +1, +2 e +5, e 20 segundos por carta",
    );
    expect(defaultsSummary({ startCents: 750, incrementsCents: [250], seconds: 30 })).toBe("Todas com lance inicial de R$ 7,50, botão +2,50, e 30 segundos por carta");
    expect(parseIncrements("1, 2, 5")).toEqual([100, 200, 500]);
    expect(parseIncrements("+5 +1")).toEqual([100, 500]);
    expect(parseIncrements("2,50")).toEqual([250]);
    expect(parseIncrements("1, 2, 5, 10")).toBeNull();
    expect(parseIncrements("abc")).toBeNull();
    expect(parseIncrements("")).toBeNull();
  });

  it("horário marcado de início nunca está no passado", () => {
    const times = ["19:00", "20:00", "21:00"];
    // 15h em Brasília
    expect(defaultSlot(new Date("2026-10-09T18:00:00Z"), times)).toEqual({ date: "2026-10-09", time: "20:00" });
    // 20h30 em Brasília: sobra 21h
    expect(defaultSlot(new Date("2026-10-09T23:30:00Z"), times)).toEqual({ date: "2026-10-09", time: "21:00" });
    // 23h em Brasília: amanhã às 20h
    expect(defaultSlot(new Date("2026-10-10T02:00:00Z"), times)).toEqual({ date: "2026-10-10", time: "20:00" });
    expect(isPast("2026-10-09T23:00:00.000Z", Date.parse("2026-10-09T23:30:00Z"))).toBe(true);
    expect(isPast("2026-10-10T00:00:00.000Z", Date.parse("2026-10-09T23:30:00Z"))).toBe(false);
  });
});
