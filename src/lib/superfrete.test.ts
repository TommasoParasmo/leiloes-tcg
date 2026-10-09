import { afterEach, describe, expect, it, vi } from "vitest";
import { cardPackage, parseQuote, quoteRequestBody, quoteShipping, SuperfreteError } from "./superfrete";

afterEach(() => vi.unstubAllEnvs());

describe("superfrete", () => {
  it("pacote de cartas: medidas mínimas e peso por carta", () => {
    expect(cardPackage(1)).toEqual({ height: 2, width: 11, length: 16, weight: 0.07 });
    expect(cardPackage(21)).toMatchObject({ height: 3, weight: 0.47 });
    expect(cardPackage(500).height).toBe(10);
  });

  it("monta o pedido com PAC, SEDEX e Mini Envios", () => {
    expect(quoteRequestBody("04538133", "01310100", 2)).toMatchObject({ from: { postal_code: "04538133" }, to: { postal_code: "01310100" }, services: "1,2,17" });
  });

  it("lê a resposta: ignora serviço com erro, ordena pelo mais barato", () => {
    const opts = parseQuote([
      { id: 2, name: "SEDEX", price: 31.4, delivery_time: 2, delivery_range: { min: 1, max: 2 } },
      { id: 17, name: "Mini Envios", has_error: true, error: "Peso excedido" },
      { id: 1, name: "PAC", price: "18,90", delivery_time: 7 },
    ]);
    expect(opts).toEqual([
      { serviceId: "1", name: "PAC", priceCents: 1890, days: 7 },
      { serviceId: "2", name: "SEDEX", priceCents: 3140, days: 2 },
    ]);
    expect(parseQuote({ message: "erro" })).toEqual([]);
  });

  it("sem token não chama a API; token recusado vira erro claro", async () => {
    vi.stubEnv("SUPERFRETE_TOKEN", "");
    const f = vi.fn();
    await expect(quoteShipping("04538133", "01310100", 1, f)).rejects.toEqual(new SuperfreteError("not_configured"));
    expect(f).not.toHaveBeenCalled();

    vi.stubEnv("SUPERFRETE_TOKEN", "tok");
    const denied = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(quoteShipping("04538133", "01310100", 1, denied as unknown as typeof fetch)).rejects.toMatchObject({ reason: "rejected" });

    const ok = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      return new Response(JSON.stringify([{ id: 1, name: "PAC", price: 20, delivery_time: 5 }]), { status: 200 });
    });
    expect(await quoteShipping("04538133", "01310100", 1, ok as unknown as typeof fetch)).toEqual([{ serviceId: "1", name: "PAC", priceCents: 2000, days: 5 }]);
  });
});
