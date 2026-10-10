/** Nada preenchido: "terminar" só sai, sem cobrar foto, nome e valor da próxima carta. */
export function isBlankCard(v: { name: string; price: string }, photoCount: number): boolean {
  return photoCount === 0 && !v.name.trim() && !v.price.trim();
}

const LANGUAGE_NAMES: Record<string, string> = { PT: "Português", EN: "Inglês", JP: "Japonês", Outro: "Outro idioma" };

/** "Português · NM · 151 · Nº 025/165": o que vai salvo sem abrir o "Mudar". */
export function cardSummary(v: { language: string; condition: string; collection: string; cardNumber: string; tcg: string }): string {
  return [
    v.tcg !== "Pokémon" && v.tcg,
    LANGUAGE_NAMES[v.language] ?? v.language,
    v.condition,
    v.collection.trim() && v.collection.trim(),
    v.cardNumber.trim() && `Nº ${v.cardNumber.trim()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
