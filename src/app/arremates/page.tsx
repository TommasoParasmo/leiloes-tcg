import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense } from "react";
import { PageLoading } from "@/components/ui/page-loading";
import { AccumulationCard } from "@/components/accumulation-card";
import { CloseLotButton } from "@/components/buyer/close-lot-button";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { myLots } from "@/lib/buyer";
import { formatBRL } from "@/lib/money";
import { fetchOrders, formatDue } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Minhas cartas · Bate Carta" };

export default function ArrematesPage() {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading />}>
        <Arremates />
      </Suspense>
      <TabBar active="arremates" />
    </>
  );
}

/** Minhas cartas: o que ganhou, quanto deu, até quando pagar e um botão "Pagar com Pix". */
async function Arremates() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/entrar?next=/arremates");
  const [lots, orders] = await Promise.all([
    myLots(sb),
    fetchOrders(sb, { userId: data.user.id, statuses: ["awaiting_shipping_quote", "awaiting_payment", "proof_sent"] }),
  ]);
  // um lote aberto por leiloeiro: cada um vira um cartão com o seu "Pagar com Pix"
  const open = lots
    .filter((l) => l.status === "open")
    .map((lot) => ({ lot, cards: lot.wins.filter((w) => w.status !== "cancelled").length }))
    .filter((o) => o.cards > 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-28">
      <h1 className="font-display text-xl font-bold">Minhas cartas</h1>

      {orders.map((o) => (
        <Link key={o.id} href={`/conta/pedidos/${o.id}`} className="flex flex-col gap-2 rounded-md border border-accent/50 bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold">
              {o.items.length} {o.items.length === 1 ? "carta" : "cartas"}
            </span>
            <span className="font-display text-lg font-bold tabular">{formatBRL(o.total_cents)}</span>
          </div>
          <span className="truncate text-xs text-muted">{o.items.map((i) => i.card_name).join(", ")}</span>
          {o.status === "awaiting_payment" ? (
            <>
              {o.due_at && <span className="text-sm font-bold text-warn">Pague até {formatDue(o.due_at)}</span>}
              <span className="flex min-h-[52px] items-center justify-center rounded-md bg-accent font-bold text-on-accent shadow-accent">Pagar com Pix</span>
            </>
          ) : (
            <span className="text-sm text-muted">{o.status === "proof_sent" ? "Você avisou que pagou. O leiloeiro confere e confirma." : "O leiloeiro está calculando o frete. O Pix aparece aqui."}</span>
          )}
        </Link>
      ))}

      {open.map(({ lot, cards }) => (
        <Fragment key={lot.id}>
          <AccumulationCard lot={lot} />
          {lot.due_at && <p className="-mt-2 text-sm font-bold text-warn">Pague até {formatDue(lot.due_at)}</p>}
          <CloseLotButton lotId={lot.id} totalCents={lot.total_cents} cards={cards} label="Pagar com Pix" />
        </Fragment>
      ))}

      {!orders.length && !open.length && <p className="text-sm text-muted">Você ainda não ganhou nenhuma carta. Quando ganhar, ela aparece aqui.</p>}

      <section className="flex gap-3 rounded-md border border-line bg-surface p-3 text-sm">
        <span aria-hidden className="mt-0.5 h-5 w-3.5 shrink-0 rounded-[3px] bg-warn" />
        <p className="text-muted">
          Se o Pix passar do prazo, você leva um cartão amarelo. Com 2 cartões amarelos, seus lances ficam bloqueados até você acertar o que deve.
        </p>
      </section>

      <Link href="/conta/pedidos" className="text-center text-sm font-bold text-muted underline-offset-2 hover:underline">
        Ver pedidos antigos
      </Link>
    </main>
  );
}
