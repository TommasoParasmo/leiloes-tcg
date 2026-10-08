import { Pill } from "@/components/ui/pill";
import type { CardInfo } from "@/lib/auction/types";
import { formatBRL } from "@/lib/money";

export function CardTitle({ card, extra }: { card: CardInfo; extra?: string }) {
  const line = [card.variant, card.collection, card.card_number].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h1 className="font-display text-xl font-bold leading-tight">{card.name}</h1>
        {line && <p className="text-sm text-muted">{line}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {card.language && <Pill>{card.language}</Pill>}
        {card.condition && <Pill>{card.condition}</Pill>}
        {card.liga_price_cents != null && <Pill>Liga {formatBRL(card.liga_price_cents)}</Pill>}
        {extra && <Pill>{extra}</Pill>}
      </div>
    </div>
  );
}
