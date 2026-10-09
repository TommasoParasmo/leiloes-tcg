import { Kicker } from "@/components/ui/label";
import { bidHeadline, formatCountdown } from "@/lib/auction/logic";
import type { RoundState } from "@/lib/auction/types";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";

/** Lance atual + cronômetro (design §5 BidBox). Sempre visível sem rolar. Quem está ganhando vai em palavras. */
export function BidBox({ state, remaining, progress }: { state: RoundState; remaining: number | null; progress: number }) {
  const headline = bidHeadline(state);
  const urgent = remaining != null && remaining <= 10_000 && state.status === "open";
  const hasTimer = remaining != null;
  return (
    <section aria-label="Lance atual" className="rounded-md border border-line bg-surface p-4">
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
          <p className={cn("truncate text-base font-bold", headline.tone === "win" ? "text-win" : headline.tone === "live" ? "text-live" : "text-muted")}>{headline.text}</p>
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
