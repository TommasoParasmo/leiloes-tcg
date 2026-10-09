import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardPackage,
  createLabel,
  errorDetail,
  labelInfo,
  labelIsPaid,
  labelRequestBody,
  parseQuote,
  printLabel,
  quoteRequestBody,
  quoteShipping,
  serviceIdFromName,
  SuperfreteError,
  type LabelInput,
} from "./superfrete";

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

  it("dados recusados pelo SuperFrete trazem o motivo", async () => {
    vi.stubEnv("SUPERFRETE_TOKEN", "tok");
    const bad = vi.fn(async () => new Response(JSON.stringify({ message: "Dados inválidos", errors: { "to.postal_code": ["CEP inválido"] } }), { status: 422 }));
    await expect(quoteShipping("04538133", "0", 1, bad as unknown as typeof fetch)).rejects.toMatchObject({ reason: "invalid", detail: "Dados inválidos CEP inválido" });
    const down = vi.fn(async () => new Response("", { status: 502 }));
    await expect(quoteShipping("04538133", "01310100", 1, down as unknown as typeof fetch)).rejects.toMatchObject({ reason: "unavailable" });
    expect(errorDetail("x".repeat(10))).toBeUndefined();
    expect(errorDetail({ error: "a".repeat(300) })).toHaveLength(200);
  });
});

const input: LabelInput = {
  from: { name: "Loja", address: "Rua Funchal", number: "418", complement: null, district: "Vila Olímpia", city: "São Paulo", state_abbr: "SP", postal_code: "04538133" },
  to: { name: "Pessoa", address: "Av. Paulista", number: "1578", complement: " ", district: "Bela Vista", city: "São Paulo", state_abbr: "SP", postal_code: "01310100", document: "12345678909" },
  items: [
    { name: "Charizard", amount_cents: 15000 },
    { name: "Pikachu", amount_cents: 250 },
  ],
};

describe("etiqueta do SuperFrete", () => {
  it("serviço da cotação vira o código do SuperFrete", () => {
    expect(serviceIdFromName("PAC")).toBe(1);
    expect(serviceIdFromName("SEDEX 10")).toBe(2);
    expect(serviceIdFromName("Mini Envios")).toBe(17);
    expect(serviceIdFromName("Frete")).toBeNull();
    expect(serviceIdFromName(null)).toBeNull();
  });

  it("monta a etiqueta: endereços sem campos vazios, uma linha por carta, declaração de conteúdo", () => {
    const body = labelRequestBody(input, 2);
    expect(body.service).toBe(2);
    expect(body.from).not.toHaveProperty("complement");
    expect(body.to).not.toHaveProperty("complement");
    expect(body.to).toMatchObject({ name: "Pessoa", document: "12345678909", postal_code: "01310100" });
    expect(body.products).toEqual([
      { name: "Charizard", quantity: "1", unitary_value: "150.00" },
      { name: "Pikachu", quantity: "1", unitary_value: "2.50" },
    ]);
    expect(body.volumes).toEqual(cardPackage(2));
    expect(body.options).toMatchObject({ non_commercial: true });
    // limites do SuperFrete: rua 50, número 10, complemento 20
    const long = labelRequestBody({ ...input, to: { ...input.to, address: "A".repeat(60), number: "1".repeat(12), complement: "c".repeat(30) } }, 1);
    expect(long.to).toMatchObject({ address: "A".repeat(50), number: "1".repeat(10), complement: "c".repeat(20) });
  });

  it("cria no carrinho, consulta a situação e pega o PDF, sempre com o token", async () => {
    vi.stubEnv("SUPERFRETE_TOKEN", "tok");
    vi.stubEnv("SUPERFRETE_URL", "https://sandbox.superfrete.com");
    const calls: { url: string; method: string; body: unknown }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/api/v0/cart")) return new Response(JSON.stringify({ id: "01JK6D99A7SVYXV03C3ZFS7CXA", status: "pending" }));
      if (url.includes("/api/v0/order/info/")) return new Response(JSON.stringify({ id: "x", status: "released", tracking: " ec451638075br " }));
      return new Response(JSON.stringify({ url: "https://sandbox.superfrete.com/_etiqueta/pdf/abc" }));
    }) as unknown as typeof fetch;

    expect(await createLabel(input, 1, f)).toEqual({ id: "01JK6D99A7SVYXV03C3ZFS7CXA", status: "pending" });
    expect(await labelInfo("01JK6D99A7SVYXV03C3ZFS7CXA", f)).toEqual({ status: "released", tracking: "EC451638075BR" });
    expect(await printLabel("01JK6D99A7SVYXV03C3ZFS7CXA", f)).toBe("https://sandbox.superfrete.com/_etiqueta/pdf/abc");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://sandbox.superfrete.com/api/v0/cart",
      "GET https://sandbox.superfrete.com/api/v0/order/info/01JK6D99A7SVYXV03C3ZFS7CXA",
      "POST https://sandbox.superfrete.com/api/v0/tag/print",
    ]);
    expect(calls[2].body).toEqual({ orders: ["01JK6D99A7SVYXV03C3ZFS7CXA"] });
  });

  it("resposta sem id não vira etiqueta; link que não é https é ignorado; só paga pode imprimir", async () => {
    vi.stubEnv("SUPERFRETE_TOKEN", "tok");
    const noId = vi.fn(async () => new Response(JSON.stringify({ message: "ok" }))) as unknown as typeof fetch;
    await expect(createLabel(input, 1, noId)).rejects.toEqual(new SuperfreteError("unavailable"));
    const http = vi.fn(async () => new Response(JSON.stringify({ url: "http://x/pdf" }))) as unknown as typeof fetch;
    expect(await printLabel("a", http)).toBeNull();
    const cancelled = vi.fn(async () => new Response(JSON.stringify({ status: "Cancelled" }))) as unknown as typeof fetch;
    expect(await labelInfo("a", cancelled)).toEqual({ status: "canceled", tracking: null });
    expect(labelIsPaid("pending")).toBe(false);
    expect(labelIsPaid("canceled")).toBe(false);
    expect(labelIsPaid("released")).toBe(true);
    expect(labelIsPaid("posted")).toBe(true);
  });
});
