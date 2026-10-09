import { formatCountdown } from "@/lib/auction/logic";

/** Aviso do intervalo do leilão, igual na sala e no painel do leiloeiro. */
export function BreakBanner({ remaining, children }: { remaining: number; children?: React.ReactNode }) {
  return (
    <section aria-labelledby="intervalo-titulo" className="flex flex-col items-center gap-1 rounded-md border border-warn/40 bg-warn/10 p-4 text-center">
      <h2 id="intervalo-titulo" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-warn">
        Intervalo
      </h2>
      {remaining > 0 ? (
        <p className="text-sm">
          Voltamos em <b className="tabular font-display text-2xl">{formatCountdown(remaining)}</b>
        </p>
      ) : (
        <p className="text-sm font-bold">Voltando…</p>
      )}
      <p className="text-xs text-muted">Ninguém dá lance durante o intervalo; a carta continua de onde parou.</p>
      {children}
    </section>
  );
}
