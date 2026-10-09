import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";
import { Spinner } from "@/components/ui/spinner";

export type BuyButtonState = "waiting" | "ready" | "pending";

/** Botão "Quero esta carta" do modo rapidez (design §5 BuyButton). */
export function BuyButton({ state, priceCents, onBuy }: { state: BuyButtonState; priceCents: number; onBuy: () => void }) {
  const waiting = state === "waiting";
  return (
    <button
      type="button"
      disabled={state !== "ready"}
      aria-busy={state === "pending" || undefined}
      onClick={onBuy}
      className={cn(
        "relative flex min-h-[88px] w-full flex-col items-center justify-center rounded-lg font-display transition-colors duration-150",
        waiting ? "border-2 border-dashed border-line bg-transparent text-muted" : "bg-accent text-on-accent shadow-accent",
        state === "pending" && "opacity-80",
      )}
    >
      <span className="text-[26px] font-extrabold leading-none">{waiting ? "Espere" : "Quero esta carta"}</span>
      <span className="mt-1 font-body text-sm font-bold opacity-85">
        {waiting ? "O leiloeiro vai liberar a carta" : `Quem tocar primeiro leva por ${formatBRL(priceCents)}`}
      </span>
      {state === "pending" && <Spinner className="absolute right-4 top-4" />}
    </button>
  );
}
