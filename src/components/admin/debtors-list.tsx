"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminRpc } from "@/lib/admin-data";
import { auctionMessage } from "@/lib/auction/codes";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";
import { formatDue } from "@/lib/orders";
import type { Debtor } from "@/lib/painel";
import { createClient } from "@/lib/supabase/client";

/** Uma linha por pedido em aberto e um botão: Recebi o Pix (pede um segundo toque para confirmar). */
export function DebtorsList({ debtors, waitingShipping }: { debtors: Debtor[]; waitingShipping: number }) {
  const router = useRouter();
  const [sb] = useState(createClient);
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function confirm(d: Debtor) {
    setPending(d.orderId);
    setError(null);
    try {
      const r = await adminRpc(sb, "admin_confirm_payment", { p_order_id: d.orderId });
      if (!r.ok) setError({ id: d.orderId, text: auctionMessage(r) });
      else {
        setDone((s) => [...s, d.orderId]);
        setMessage(`Pix de ${d.nickname} anotado. O pedido foi para envio.`);
        router.refresh();
      }
    } catch {
      setError({ id: d.orderId, text: "Sem conexão com o servidor. Tente de novo." });
    }
    setPending(null);
    setAsking(null);
  }

  const shown = debtors.filter((d) => !done.includes(d.orderId));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
      <p className="text-sm text-muted">Toque quando o Pix cair na sua conta.</p>
      <p aria-live="polite" className={message ? "rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win" : "sr-only"}>
        {message ?? ""}
      </p>

      {shown.length === 0 && <p className="rounded-md border border-line bg-surface p-5 text-center font-bold">Ninguém te deve agora.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((d) => (
          <li key={d.orderId} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-2 rounded-md border bg-surface p-3", d.late ? "border-danger/45" : "border-line")}>
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{d.nickname}</p>
              <p className={cn("text-xs", d.late ? "text-danger" : "text-muted")}>
                {d.cards} {d.cards === 1 ? "carta" : "cartas"}
                {d.dueAt ? (d.late ? ` · venceu ${formatDue(d.dueAt)}` : ` · vence ${formatDue(d.dueAt)}`) : ""}
                {d.proofSent ? " · mandou comprovante" : ""}
              </p>
            </div>
            <p className="text-right font-display text-xl font-extrabold tabular">{formatBRL(d.totalCents)}</p>
            {asking === d.orderId ? (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setAsking(null)} disabled={pending === d.orderId} className="min-h-[50px] rounded-sm bg-surface-2 font-bold">
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => void confirm(d)}
                  disabled={pending === d.orderId}
                  aria-busy={pending === d.orderId || undefined}
                  className="min-h-[50px] rounded-sm bg-win font-extrabold text-[#06231A] disabled:opacity-70"
                >
                  {pending === d.orderId ? "Anotando…" : `Sim, caiu ${formatBRL(d.totalCents)}`}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => (setAsking(d.orderId), setError(null))} className="col-span-2 min-h-[50px] rounded-sm bg-win font-extrabold text-[#06231A]">
                Recebi o Pix
              </button>
            )}
            {error?.id === d.orderId && (
              <p role="alert" className="col-span-2 text-sm text-danger">
                {error.text}
              </p>
            )}
          </li>
        ))}
      </ul>

      {waitingShipping > 0 && (
        <Link href="/painel/pedidos" className="flex min-h-12 items-center justify-between rounded-md border border-line bg-surface px-3 text-sm font-bold">
          <span>
            {waitingShipping} {waitingShipping === 1 ? "pedido esperando" : "pedidos esperando"} o frete para virar Pix
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}
    </main>
  );
}
