import Link from "next/link";
import { formatServerTime } from "@/lib/auction/logic";
import { formatBRL } from "@/lib/money";

/** Cartão do vencedor: borda 2 px em degradê holo (design §5 WinnerCard). */
export function WinnerCard({ amountCents, cardName, at }: { amountCents: number; cardName: string; at: string | null }) {
  return (
    <section className="rounded-lg bg-holo p-[2px]">
      <div className="rounded-[20px] bg-[linear-gradient(rgba(9,10,18,.86),rgba(9,10,18,.94)),url('/brand/winner-bg.jpg')] bg-cover bg-center p-5 text-center">
        <p className="text-xs font-extrabold uppercase tracking-[.12em] text-holo">Você arrematou</p>
        <p className="font-display text-[34px] font-extrabold tabular">{formatBRL(amountCents)}</p>
        <p className="text-sm text-muted">
          {cardName}
          {at && ` · ${formatServerTime(at)}`}
        </p>
      </div>
    </section>
  );
}

export function WonNextSteps() {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <p className="font-bold">Adicionada aos seus arremates</p>
      <p className="mt-1 text-sm text-muted">Você pode pagar e pedir o envio ou acumular para o próximo leilão.</p>
      <Link href="/arremates" className="mt-3 inline-flex min-h-12 items-center rounded-md border border-line px-4 font-bold">
        Ver arremates
      </Link>
    </section>
  );
}

/** Resultado neutro para quem não levou (design §5 LostCard). */
export function LostCard({ winner, amountCents, at, withMs }: { winner: string | null; amountCents: number | null; at: string | null; withMs?: boolean }) {
  if (!winner || amountCents == null) {
    return (
      <section className="rounded-md border border-line bg-surface p-4 text-center">
        <p className="font-bold">Rodada encerrada sem lances</p>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-line bg-surface p-4 text-center">
      <p className="font-bold">{withMs ? `${winner} arrematou primeiro` : `${winner} venceu`}</p>
      <p className="mt-1 text-sm text-muted tabular">
        Arrematada por {formatBRL(amountCents)}
        {at && ` às ${formatServerTime(at, withMs)}`}
      </p>
    </section>
  );
}
