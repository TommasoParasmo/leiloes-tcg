import { describe, expect, it } from "vitest";
import { buildRoundResultMessage, whatsappShareUrl } from "./message";

describe("mensagem de resultado", () => {
  it("segue o modelo combinado", () => {
    const text = buildRoundResultMessage(
      {
        card_name: "Horsea",
        card_variant: "Poké Ball Holo",
        amount_cents: 900,
        winner_nickname: "João",
        event_number: 15,
        round_id: "abc",
        photo_path: null,
      },
      "https://leilao.exemplo.com/",
    );
    expect(text).toBe(
      [
        "🏆 CARTA ARREMATADA!",
        "",
        "🃏 Horsea — Poké Ball Holo",
        "💰 Valor: R$ 9,00",
        "👤 Vencedor: João",
        "🎯 Leilão #15",
        "",
        "✅ Resultado confirmado!",
        "🔗 Confira no site: https://leilao.exemplo.com/resultado/abc",
      ].join("\n"),
    );
    expect(whatsappShareUrl("a b")).toBe("https://wa.me/?text=a%20b");
  });

  it("rodada sem lances avisa que a carta volta", () => {
    const text = buildRoundResultMessage(
      { card_name: "Horsea", card_variant: null, amount_cents: null, winner_nickname: null, event_number: 15, round_id: "abc", photo_path: null },
      "https://leilao.exemplo.com",
    );
    expect(text).toBe(["🃏 Horsea", "🎯 Leilão #15", "", "Sem lances nesta rodada. A carta volta em um próximo leilão!"].join("\n"));
  });
});
