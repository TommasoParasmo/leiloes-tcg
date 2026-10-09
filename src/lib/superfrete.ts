/**
 * SuperFrete (https://superfrete.com): cotação (/api/v0/calculator) e etiqueta (/api/v0/cart).
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
  constructor(
    public readonly reason: "not_configured" | "unavailable" | "rejected" | "invalid",
    /** mensagem do SuperFrete quando ele recusa os dados (ex.: CEP ou CPF inválido) */
    public readonly detail?: string,
  ) {
    super(reason);
  }
}

/** Chamada autenticada à API do SuperFrete. Erros viram SuperfreteError; devolve o JSON da resposta. */
async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }, fetchImpl: typeof fetch): Promise<unknown> {
  const token = process.env.SUPERFRETE_TOKEN;
  if (!token) throw new SuperfreteError("not_configured");
  const base = process.env.SUPERFRETE_URL || "https://api.superfrete.com";
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "Bate Carta (leiloes-tcg.vercel.app)",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new SuperfreteError("unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new SuperfreteError("rejected");
  const json = await res.json().catch(() => null);
  if (res.status >= 400 && res.status < 500) throw new SuperfreteError("invalid", errorDetail(json));
  if (!res.ok) throw new SuperfreteError("unavailable");
  return json;
}

/** Texto curto do erro do SuperFrete, para o leiloeiro saber o que corrigir. */
export function errorDetail(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const j = json as { message?: unknown; error?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof j.message === "string") parts.push(j.message);
  if (typeof j.error === "string") parts.push(j.error);
  if (j.errors && typeof j.errors === "object") {
    for (const v of Object.values(j.errors as Record<string, unknown>)) {
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) parts.push(...v.filter((x): x is string => typeof x === "string"));
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : undefined;
}

export async function quoteShipping(fromCep: string, toCep: string, cards: number, fetchImpl: typeof fetch = fetch): Promise<ShippingOption[]> {
  return parseQuote(await call("/api/v0/calculator", { method: "POST", body: quoteRequestBody(fromCep, toCep, cards) }, fetchImpl));
}

// ---------------------------------------------------------------------------
// Etiqueta: vai para o carrinho do SuperFrete; o leiloeiro paga lá e o site busca rastreio e PDF.
// ---------------------------------------------------------------------------

/** Serviços aceitos na etiqueta (códigos do SuperFrete). */
export const LABEL_SERVICES = [
  { id: 1, name: "PAC" },
  { id: 2, name: "SEDEX" },
  { id: 17, name: "Mini Envios" },
] as const;
export type LabelServiceId = (typeof LABEL_SERVICES)[number]["id"];

/** Serviço da cotação ("SEDEX", "Mini Envios"…) para o código do SuperFrete; null quando não dá para saber. */
export function serviceIdFromName(name: string | null | undefined): LabelServiceId | null {
  const n = (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/sedex/.test(n)) return 2;
  if (/mini/.test(n)) return 17;
  if (/\bpac\b/.test(n)) return 1;
  return null;
}

export interface LabelAddress {
  name: string;
  address: string;
  number: string | null;
  complement: string | null;
  district: string;
  city: string;
  state_abbr: string;
  postal_code: string;
  document?: string | null;
}

export interface LabelInput {
  from: LabelAddress;
  to: LabelAddress;
  items: { name: string; amount_cents: number }[];
}

const clean = (a: LabelAddress) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return out;
};

/** Corpo do POST /api/v0/cart: um envelope de cartas, com declaração de conteúdo (sem nota fiscal). */
export function labelRequestBody(input: LabelInput, service: LabelServiceId) {
  return {
    from: clean(input.from),
    to: clean(input.to),
    service,
    products: input.items.map((i) => ({ name: i.name.slice(0, 100), quantity: "1", unitary_value: (i.amount_cents / 100).toFixed(2) })),
    volumes: cardPackage(input.items.length),
    options: { own_hand: false, receipt: false, non_commercial: true },
    platform: "Bate Carta",
  };
}

/** Manda a etiqueta para o carrinho do SuperFrete e devolve o id do pedido lá. */
export async function createLabel(input: LabelInput, service: LabelServiceId, fetchImpl: typeof fetch = fetch): Promise<{ id: string; status: string }> {
  const json = (await call("/api/v0/cart", { method: "POST", body: labelRequestBody(input, service) }, fetchImpl)) as { id?: unknown; status?: unknown } | null;
  const id = json && (typeof json.id === "string" || typeof json.id === "number") ? String(json.id) : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new SuperfreteError("unavailable");
  return { id, status: typeof json?.status === "string" ? json.status : "pending" };
}

export interface LabelInfo {
  status: string;
  tracking: string | null;
}

/** Situação da etiqueta no SuperFrete: pending (no carrinho), released (paga), posted, delivered, canceled. */
export async function labelInfo(id: string, fetchImpl: typeof fetch = fetch): Promise<LabelInfo> {
  const json = (await call(`/api/v0/order/info/${encodeURIComponent(id)}`, { method: "GET" }, fetchImpl)) as { status?: unknown; tracking?: unknown } | null;
  const tracking = typeof json?.tracking === "string" && /^[A-Za-z0-9]{5,40}$/.test(json.tracking.trim()) ? json.tracking.trim().toUpperCase() : null;
  return { status: typeof json?.status === "string" && json.status ? json.status.toLowerCase() : "pending", tracking };
}

/** Etiqueta paga já pode ser impressa. */
export const labelIsPaid = (status: string) => !["pending", "canceled", "cancelled"].includes(status);

/** Link do PDF da etiqueta (só depois de paga no SuperFrete). */
export async function printLabel(id: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const json = (await call("/api/v0/tag/print", { method: "POST", body: { orders: [id] } }, fetchImpl)) as { url?: unknown } | null;
  return typeof json?.url === "string" && json.url.startsWith("https://") ? json.url : null;
}
