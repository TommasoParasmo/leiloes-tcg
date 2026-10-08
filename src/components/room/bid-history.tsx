import { formatServerTime } from "@/lib/auction/logic";
import type { RecentBid } from "@/lib/auction/types";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";

export function BidHistory({ bids }: { bids: RecentBid[] }) {
  if (!bids.length) return <p className="text-center text-sm text-muted">Nenhum lance ainda.</p>;
  return (
    <ol aria-label="Últimos lances" className="flex flex-col gap-1.5 text-sm">
      {bids.slice(0, 5).map((b) => (
        <li key={b.seq} className={cn("flex justify-between tabular", b.is_me ? "font-extrabold text-text" : "text-muted")}>
          <span>{b.is_me ? "Você" : b.nickname}</span>
          <span>
            {formatBRL(b.amount_cents)} · {formatServerTime(b.created_at)}
          </span>
        </li>
      ))}
    </ol>
  );
}
