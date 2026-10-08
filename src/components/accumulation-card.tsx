import { Pill } from "@/components/ui/pill";
import type { Lot } from "@/lib/buyer";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";

/** Cartas guardadas com o leiloeiro e o contador de acumulação (design §5 AccumulationCard). */
export function AccumulationCard({ lot, headingLevel = 2 }: { lot: Lot; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const used = Math.min(lot.events_used, lot.max_events);
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <Heading className="font-bold">{lot.status === "open" ? "Cartas acumuladas" : `Lote desde o Leilão #${lot.first_event_number}`}</Heading>
        {lot.must_close ? (
          <Pill tone="warn">
            {used}/{lot.max_events} · fechar agora
          </Pill>
        ) : (
          <Pill tone="acc">
            {used}/{lot.max_events}
          </Pill>
        )}
      </div>
      <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${lot.max_events}, 1fr)` }} aria-hidden>
        {Array.from({ length: lot.max_events }, (_, i) => (
          <span key={i} className={cn("h-1.5 rounded-pill", i < used ? (lot.must_close ? "bg-warn" : "bg-accent") : "bg-surface-2")} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        {lot.must_close
          ? "Você chegou ao limite de acumulação. Feche o lote (pagamento e envio) antes de participar de outro leilão."
          : `Desde o Leilão #${lot.first_event_number}. Você pode acumular por até ${lot.max_events} leilões seguidos.`}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {lot.wins.map((w) => (
          <li key={w.id} className="flex items-center gap-3">
            {w.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.photo_url} alt="" loading="lazy" width={44} height={44} className="size-11 rounded-[5px] object-cover" />
            ) : (
              <span aria-hidden className="size-11 rounded-[5px] bg-surface-2" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{w.card_name}</p>
              <p className="text-xs text-muted">
                {[w.card_variant, `Leilão #${w.event_number}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="text-sm font-bold tabular">{formatBRL(w.amount_cents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-dashed border-line pt-3 font-extrabold">
        <span>Total</span>
        <span className="tabular">{formatBRL(lot.total_cents)}</span>
      </div>
    </section>
  );
}
