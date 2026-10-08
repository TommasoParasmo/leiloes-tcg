import { describe, expect, it } from "vitest";
import { crc16, pixCopyPaste } from "./pix";

describe("pix copia e cola", () => {
  it("CRC16 confere com o valor de referência do padrão", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("monta o BR Code com chave, valor, nome e cidade normalizados", () => {
    const code = pixCopyPaste({ key: "pix@batecarta.com", name: "Bate Carta Leilões", city: "São Paulo", amountCents: 4550, txid: "pedido-ab12" });
    expect(code.startsWith("000201")).toBe(true);
    expect(code).toContain("0014br.gov.bcb.pix0117pix@batecarta.com");
    expect(code).toContain("540545.50");
    expect(code).toContain("5918BATE CARTA LEILOES");
    expect(code).toContain("6009SAO PAULO");
    expect(code).toContain("62140510PEDIDOAB12");
    expect(code.slice(-8, -4)).toBe("6304");
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });

  it("recusa valor zero ou quebrado", () => {
    expect(() => pixCopyPaste({ key: "k", name: "n", city: "c", amountCents: 0 })).toThrow();
    expect(() => pixCopyPaste({ key: "k", name: "n", city: "c", amountCents: 1.5 })).toThrow();
  });
});
