import { Kicker } from "@/components/ui/label";
import type { BidBoxTone } from "@/lib/auction/logic";
import { formatCountdown } from "@/lib/auction/logic";
import type { RoundState } from "@/lib/auction/types";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";

const borders: Record<BidBoxTone, string> = {
  neutral: "border-line",
  leading: "border-win/55",
  outbid: "border-live/60",
  ending: "border-line",
};

/** Lance atual + cronômetro (design §5 BidBox). Sempre visível sem rolar. */
export function BidBox({ state, remaining, progress, tone }: { state: RoundState; remaining: number | null; progress: number; tone: BidBoxTone }) {
  const urgent = remaining != null && remaining <= 10_000 && state.status === "open";
  const hasTimer = remaining != null;
  return (
    <section aria-label="Lance atual" className={cn("rounded-md border bg-surface p-4", borders[tone])}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Lance atual</Kicker>
          <p className="font-display text-3xl font-extrabold tabular leading-tight">
            {state.current_amount_cents != null
              ? formatBRL(state.current_amount_cents)
              : state.start_price_cents != null
                ? formatBRL(state.start_price_cents)
                : "Sem lances"}
          </p>
          <p className="truncate text-sm text-muted">
            {tone === "leading" ? (
              <span className="font-bold text-win">● Você está liderando</span>
            ) : state.leading_nickname ? (
              <>
                Liderando: <b className="text-text">{state.leading_nickname}</b>
              </>
            ) : state.start_price_cents != null ? (
              "Lance inicial"
            ) : (
              "Escolha uma opção abaixo"
            )}
          </p>
        </div>
        <div className="text-right">
          <Kicker>{state.status === "paused" ? "Pausado" : hasTimer ? "Encerra em" : "Encerramento"}</Kicker>
          {/* o servidor e o aparelho calculam o tempo em instantes diferentes: diferença esperada na hidratação */}
          <p suppressHydrationWarning className={cn("font-display text-2xl font-extrabold tabular", urgent ? "text-live" : "text-accent-text")}>
            {hasTimer ? formatCountdown(remaining) : "Manual"}
          </p>
        </div>
      </div>
      {hasTimer && (
        <div className="mt-3 h-[5px] overflow-hidden rounded-pill bg-surface-2" aria-hidden>
          <div suppressHydrationWarning className={cn("h-full rounded-pill", urgent ? "bg-live" : "bg-holo")} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </section>
  );
}
