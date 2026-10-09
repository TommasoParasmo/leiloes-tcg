"use client";
import { useState } from "react";
import Link from "next/link";
import { formatServerTime } from "@/lib/auction/logic";
import { formatBRL } from "@/lib/money";

/** Cartão do vencedor: borda 2 px em degradê holo (design §5 WinnerCard). */
export function WinnerCard({ amountCents, cardName, at }: { amountCents: number; cardName: string; at: string | null }) {
  return (
    <section className="rounded-lg bg-holo p-[2px]">
      <div className="theme-dark-scope rounded-[20px] bg-[linear-gradient(rgba(9,10,18,.86),rgba(9,10,18,.94)),url('/brand/winner-bg.jpg')] bg-cover bg-center p-5 text-center">
        <p className="text-xs font-extrabold uppercase tracking-[.12em] text-holo">Parabéns, a carta é sua!</p>
        <p className="font-display text-[34px] font-extrabold tabular">{formatBRL(amountCents)}</p>
        <p className="text-sm text-muted">
          {cardName}
          {at && ` · ${formatServerTime(at)}`}
        </p>
      </div>
    </section>
  );
}

/** Depois de ganhar: seguir no leilão (principal) ou pagar já. */
export function WonNextSteps() {
  const [staying, setStaying] = useState(false);
  if (staying) return <p className="text-center text-sm text-muted">Fique nesta tela: a próxima carta aparece sozinha.</p>;
  return (
    <section className="flex flex-col gap-2">
      <button type="button" onClick={() => setStaying(true)} className="flex min-h-[60px] items-center justify-center rounded-md bg-accent font-display text-lg font-bold text-on-accent shadow-accent">
        Continuar no leilão
      </button>
      <Link href="/arremates" className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
        Pagar agora
      </Link>
      <p className="text-center text-xs text-muted">Pode pagar agora ou tudo junto no fim, com um frete só.</p>
    </section>
  );
}

/** Resultado neutro para quem não levou (design §5 LostCard). */
export function LostCard({ winner, amountCents, at, withMs }: { winner: string | null; amountCents: number | null; at: string | null; withMs?: boolean }) {
  if (!winner || amountCents == null) {
    return (
      <section className="rounded-md border border-line bg-surface p-4 text-center">
        <p className="font-bold">Ninguém levou esta carta</p>
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
