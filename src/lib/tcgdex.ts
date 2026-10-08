// Busca de cartas Pokémon na TCGdex (api.tcgdex.net), base aberta e gratuita, com nomes
// e coleções em português. Só preenche o formulário: nada é salvo a partir daqui.
const API = "https://api.tcgdex.net/v2";

export type TcgdexLang = "pt" | "en" | "ja";

export interface CardHit {
  id: string;
  name: string;
  localId: string;
  image: string | null;
}

export interface CardPick {
  name: string;
  collection: string;
  cardNumber: string;
}

/** Idioma da busca a partir do idioma escolhido no formulário. */
export function tcgdexLang(language: string): TcgdexLang {
  return language === "PT" ? "pt" : language === "JP" ? "ja" : "en";
}

export function parseHits(json: unknown, limit = 12): CardHit[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((c): c is { id: string; name: string; localId: string; image?: string } => !!c && typeof c.id === "string" && typeof c.name === "string" && c.localId != null)
    .slice(0, limit)
    .map((c) => ({ id: c.id, name: c.name, localId: String(c.localId), image: typeof c.image === "string" ? `${c.image}/low.webp` : null }));
}

/** "130" de uma coleção com 128 cartas oficiais vira "130/128"; sem total, fica só o número. */
export function parsePick(json: unknown): CardPick | null {
  if (!json || typeof json !== "object") return null;
  const c = json as { name?: unknown; localId?: unknown; set?: { name?: unknown; cardCount?: { official?: unknown } } };
  if (typeof c.name !== "string") return null;
  const local = c.localId != null ? String(c.localId) : "";
  const official = typeof c.set?.cardCount?.official === "number" ? c.set.cardCount.official : null;
  const width = official ? String(official).length : 0;
  const num = local && official && /^\d+$/.test(local) ? `${local.padStart(width, "0")}/${String(official).padStart(width, "0")}` : local;
  return { name: c.name, collection: typeof c.set?.name === "string" ? c.set.name : "", cardNumber: num };
}

export async function searchCards(name: string, lang: TcgdexLang, signal?: AbortSignal): Promise<CardHit[]> {
  // a API não pagina sozinha: sem isso, um nome curto baixa centenas de cartas no celular
  const res = await fetch(`${API}/${lang}/cards?name=${encodeURIComponent(name)}&pagination:page=1&pagination:itemsPerPage=12`, { signal });
  if (!res.ok) return [];
  return parseHits(await res.json());
}

export async function fetchCard(id: string, lang: TcgdexLang, signal?: AbortSignal): Promise<CardPick | null> {
  const res = await fetch(`${API}/${lang}/cards/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) return null;
  return parsePick(await res.json());
}
