import type { BidChoice } from "@/lib/auction/logic";
import { cn } from "@/lib/cn";
import { formatAmountShort, formatBRL } from "@/lib/money";
import { Spinner } from "@/components/ui/spinner";

/**
 * Botões de lance na zona do polegar: um grande com o próximo valor e, embaixo, os outros
 * valores menores. Quem já está na frente vê o botão grande desativado dizendo isso.
 * Opções fixas do leiloeiro continuam em grade.
 */
export function BidButtons({
  choices,
  fixedOptions,
  leading,
  pendingAmount,
  onBid,
}: {
  choices: BidChoice[];
  fixedOptions: boolean;
  leading: boolean;
  pendingAmount: number | null;
  onBid: (amountCents: number) => void;
}) {
  const busy = pendingAmount != null;
  if (fixedOptions) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {choices.map((c) => (
          <button
            key={c.amount_cents}
            type="button"
            disabled={c.disabled || busy}
            onClick={() => onBid(c.amount_cents)}
            aria-busy={pendingAmount === c.amount_cents || undefined}
            aria-label={`Dar lance de ${formatBRL(c.amount_cents)}`}
            className={cn(
              "relative flex min-h-16 items-center justify-center rounded-md font-display text-lg font-bold tabular transition-colors duration-150",
              c.primary ? "bg-accent text-on-accent shadow-accent" : "bg-surface-2 text-text",
              "disabled:bg-surface disabled:text-muted disabled:shadow-none",
            )}
          >
            R$ {formatAmountShort(c.amount_cents)}
            {pendingAmount === c.amount_cents && <Spinner className="absolute right-2 top-2" />}
          </button>
        ))}
      </div>
    );
  }
  const [main, ...others] = choices;
  if (!main) return null;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={main.disabled || busy}
        onClick={() => onBid(main.amount_cents)}
        aria-busy={pendingAmount === main.amount_cents || undefined}
        className="relative flex min-h-16 w-full items-center justify-center rounded-md bg-accent font-display text-xl font-extrabold text-on-accent shadow-accent tabular transition-colors duration-150 disabled:bg-surface disabled:text-muted disabled:shadow-none"
      >
        {leading ? "Você já está na frente" : `Dar lance de ${formatBRL(main.amount_cents)}`}
        {pendingAmount === main.amount_cents && <Spinner className="absolute right-3 top-3" />}
      </button>
      {others.length > 0 && !leading && (
        <div className="grid grid-cols-2 gap-2">
          {others.map((c) => (
            <button
              key={c.amount_cents}
              type="button"
              disabled={c.disabled || busy}
              onClick={() => onBid(c.amount_cents)}
              aria-busy={pendingAmount === c.amount_cents || undefined}
              aria-label={`Dar lance de ${formatBRL(c.amount_cents)}`}
              className="relative flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-display font-bold tabular disabled:bg-surface disabled:text-muted"
            >
              {formatBRL(c.amount_cents)}
              {pendingAmount === c.amount_cents && <Spinner className="absolute right-2 top-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
