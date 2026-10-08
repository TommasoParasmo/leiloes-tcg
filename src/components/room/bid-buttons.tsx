import type { BidChoice } from "@/lib/auction/logic";
import { cn } from "@/lib/cn";
import { formatAmountShort, formatBRL } from "@/lib/money";
import { Spinner } from "@/components/ui/spinner";

/** Botões de lance na zona do polegar (design §5 BidButtons). */
export function BidButtons({
  choices,
  fixedOptions,
  pendingAmount,
  onBid,
}: {
  choices: BidChoice[];
  fixedOptions: boolean;
  pendingAmount: number | null;
  onBid: (amountCents: number) => void;
}) {
  const busy = pendingAmount != null;
  return (
    <div className={cn("grid gap-2", fixedOptions ? "grid-cols-2" : "grid-cols-3")}>
      {choices.map((c) => (
        <button
          key={c.amount_cents}
          type="button"
          disabled={c.disabled || busy}
          onClick={() => onBid(c.amount_cents)}
          aria-busy={pendingAmount === c.amount_cents || undefined}
          aria-label={`Dar lance de ${formatBRL(c.amount_cents)}`}
          className={cn(
            "relative flex min-h-16 flex-col items-center justify-center rounded-md font-display font-bold tabular transition-colors duration-150",
            c.primary ? "bg-accent text-on-accent shadow-accent" : "bg-surface-2 text-text",
            "disabled:bg-surface disabled:text-muted disabled:shadow-none",
          )}
        >
          <span className="text-lg">R$ {formatAmountShort(c.amount_cents)}</span>
          {c.increment_cents != null && <span className="font-body text-xs font-bold opacity-80">+{formatAmountShort(c.increment_cents)}</span>}
          {pendingAmount === c.amount_cents && <Spinner className="absolute right-2 top-2" />}
        </button>
      ))}
    </div>
  );
}
