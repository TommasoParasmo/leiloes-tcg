const LANGUAGE_NAMES: Record<string, string> = { PT: "Português", EN: "Inglês", JP: "Japonês", Outro: "Outro idioma" };

/** "Português · NM · 151 · Nº 025/165": o que vai salvo sem abrir o "Mudar". */
export function cardSummary(v: { language: string; condition: string; collection: string; cardNumber: string; liga: string; tcg: string }): string {
  return [
    v.tcg !== "Pokémon" && v.tcg,
    LANGUAGE_NAMES[v.language] ?? v.language,
    v.condition,
    v.collection.trim() && v.collection.trim(),
    v.cardNumber.trim() && `Nº ${v.cardNumber.trim()}`,
    v.liga.trim() && `Liga R$ ${v.liga.trim()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
