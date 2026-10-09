/**
 * Cotação de frete no SuperFrete (https://superfrete.com, API /api/v0/calculator).
 * Só roda no servidor: o token fica na variável SUPERFRETE_TOKEN da Vercel.
 */

/** PAC, SEDEX e Mini Envios. */
export const SUPERFRETE_SERVICES = "1,2,17";

export interface ShippingOption {
  serviceId: string;
  name: string;
  priceCents: number;
  days: number | null;
}

/**
 * Pacote padrão de cartas: envelope com toploader. Medidas mínimas dos Correios
 * (16 × 11 × 2 cm); cada carta soma uns 20 g, e a cada 20 cartas o pacote engrossa 1 cm.
 */
export function cardPackage(cards: number) {
  const n = Math.max(1, Math.floor(cards));
  return {
    height: Math.min(2 + Math.floor((n - 1) / 20), 10),
    width: 11,
    length: 16,
    weight: Math.round((0.05 + 0.02 * n) * 1000) / 1000,
  };
}

export function quoteRequestBody(fromCep: string, toCep: string, cards: number) {
  return {
    from: { postal_code: fromCep },
    to: { postal_code: toCep },
    services: SUPERFRETE_SERVICES,
    options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
    package: cardPackage(cards),
  };
}

/** Lê a resposta do SuperFrete; serviços com erro ou sem preço ficam de fora. Mais barato primeiro. */
export function parseQuote(json: unknown): ShippingOption[] {
  if (!Array.isArray(json)) return [];
  const out: ShippingOption[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const s = item as { id?: unknown; name?: unknown; price?: unknown; delivery_time?: unknown; delivery_range?: { max?: unknown }; error?: unknown; has_error?: unknown };
    if (s.error || s.has_error) continue;
    const price = typeof s.price === "string" ? Number(s.price.replace(",", ".")) : s.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const days = typeof s.delivery_range?.max === "number" ? s.delivery_range.max : typeof s.delivery_time === "number" ? s.delivery_time : null;
    out.push({
      serviceId: String(s.id ?? ""),
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Frete",
      priceCents: Math.round(price * 100),
      days: days != null && days > 0 ? Math.round(days) : null,
    });
  }
  return out.sort((a, b) => a.priceCents - b.priceCents);
}

export class SuperfreteError extends Error {
  constructor(public readonly reason: "not_configured" | "unavailable" | "rejected") {
    super(reason);
  }
}

export async function quoteShipping(fromCep: string, toCep: string, cards: number, fetchImpl: typeof fetch = fetch): Promise<ShippingOption[]> {
  const token = process.env.SUPERFRETE_TOKEN;
  if (!token) throw new SuperfreteError("not_configured");
  const base = process.env.SUPERFRETE_URL || "https://api.superfrete.com";
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/v0/calculator`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "Bate Carta (leiloes-tcg.vercel.app)",
      },
      body: JSON.stringify(quoteRequestBody(fromCep, toCep, cards)),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new SuperfreteError("unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new SuperfreteError("rejected");
  if (!res.ok) throw new SuperfreteError("unavailable");
  return parseQuote(await res.json().catch(() => null));
}
