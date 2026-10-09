// Valores financeiros trafegam e são guardados em centavos (inteiros).
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 900 → "R$ 9,00" (espaço normal, não o NBSP do Intl, para copiar/colar no WhatsApp). */
export function formatBRL(cents: number | bigint | string): string {
  const value = typeof cents === "string" ? Number(cents) : Number(cents);
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`Valor em centavos inválido: ${cents}`);
  return brl.format(value / 100).replace(/ /g, " ");
}

/** 1000 → "10", 50 → "0,50": valor sem "R$" e sem ",00" para botões compactos. */
/** Maior preço aceito pelo banco (R$ 100.000). */
export const MAX_PRICE_CENTS = 10_000_000;

export function formatAmountShort(cents: number): string {
  return formatBRL(cents).replace(/^R\$ /, "").replace(/,00$/, "");
}

/** Converte "9", "9,5", "9,50", "1.234,56" em centavos. Retorna null se inválido. */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/R\$\s?/i, "").trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** "1 2 5" ou "6; 7,50; 8" → centavos em ordem crescente, sem repetidos. null se algum for inválido. */
export function parseBRLList(input: string): number[] | null {
  const parts = input.split(/[\s;/]+/).filter(Boolean);
  if (!parts.length) return null;
  const cents = parts.map(parseBRL);
  if (cents.some((c) => c == null || c <= 0)) return null;
  return [...new Set(cents as number[])].sort((a, b) => a - b);
}
