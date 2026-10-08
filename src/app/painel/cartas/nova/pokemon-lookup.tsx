"use client";
import { useEffect, useState } from "react";
import { fetchCard, searchCards, tcgdexLang, type CardHit, type CardPick } from "@/lib/tcgdex";

/**
 * Sugestões de cartas Pokémon enquanto o nome é digitado. Tocar numa sugestão preenche
 * nome, coleção e número; o leiloeiro ainda pode editar tudo.
 */
export function PokemonLookup({ query, language, onPick }: { query: string; language: string; onPick: (pick: CardPick) => void }) {
  const [result, setResult] = useState<{ q: string; hits: CardHit[] }>({ q: "", hits: [] });
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const q = query.trim();
  const active = q.length >= 3 && q !== picked;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const lang = tcgdexLang(language);
    const t = setTimeout(async () => {
      try {
        let hits = await searchCards(q, lang, ctrl.signal);
        // coleção sem tradução para o idioma escolhido: busca em inglês
        if (!hits.length && lang !== "en") hits = await searchCards(q, "en", ctrl.signal);
        setResult({ q, hits });
      } catch {
        // sem internet ou base fora do ar: segue sem sugestões
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, language, active]);

  if (!active || result.q !== q || !result.hits.length) return null;

  async function pick(hit: CardHit) {
    setLoading(hit.id);
    let card: CardPick | null = null;
    try {
      card = (await fetchCard(hit.id, tcgdexLang(language))) ?? (await fetchCard(hit.id, "en"));
    } catch {
      card = null;
    }
    setLoading(null);
    const chosen = card ?? { name: hit.name, collection: "", cardNumber: hit.localId };
    setPicked(chosen.name.trim());
    onPick(chosen);
  }

  return (
    <div className="-mt-1 rounded-sm border border-line bg-surface">
      <p className="px-3 pt-2 text-xs font-semibold text-muted">Sugestões: toque para preencher coleção e número</p>
      <ul className="flex max-h-72 flex-col overflow-y-auto p-1.5">
        {result.hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => void pick(h)}
              disabled={!!loading}
              className="flex min-h-14 w-full items-center gap-3 rounded-sm p-1.5 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              {h.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.image} alt="" width={34} height={47} loading="lazy" className="h-[47px] w-[34px] rounded-[3px] object-cover" />
              ) : (
                <span aria-hidden className="h-[47px] w-[34px] rounded-[3px] bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{h.name}</span>
                <span className="block truncate text-xs text-muted">
                  Nº {h.localId} · {h.id.replace(/-[^-]+$/, "").toUpperCase()}
                </span>
              </span>
              {loading === h.id && <span className="text-xs text-muted">…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
