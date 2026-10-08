import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccumulationCard } from "@/components/accumulation-card";
import { CloseLotButton } from "@/components/buyer/close-lot-button";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { myLots } from "@/lib/buyer";
import { formatDue } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Meu lote · Bate Carta" };

export default function LotePage() {
  return (
    <>
      <AppBar back="/conta" title="Meu lote" />
      <Suspense fallback={<PageLoading />}>
        <Lote />
      </Suspense>
    </>
  );
}

async function Lote() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/entrar?next=/conta/lote");
  const lot = (await myLots(sb)).find((l) => l.status === "open");

  if (!lot) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Nenhuma carta acumulada</p>
          <p className="mt-1 text-sm text-muted">Quando você arrematar, as cartas ficam guardadas aqui até fechar o lote.</p>
        </section>
        <Link href="/conta/pedidos" className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
          Ver meus pedidos
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
      <AccumulationCard lot={lot} />
      <section className="rounded-md border border-line bg-surface p-4 text-sm">
        <p className="font-bold">Prazo do Pix</p>
        <p className="mt-1 text-muted">
          {lot.due_at
            ? `Pague até ${formatDue(lot.due_at)}. O prazo é de 7 dias depois do primeiro leilão, ou 24h depois do ${lot.max_events}º leilão acumulado, o que vier antes.`
            : "O prazo começa quando o leilão terminar: 7 dias, ou 24h depois do 2º leilão acumulado."}
        </p>
        <p className="mt-2 text-muted">Fechando agora, o leiloeiro calcula o frete e você paga cartas e frete num Pix só.</p>
      </section>
      <CloseLotButton lotId={lot.id} totalCents={lot.total_cents} cards={lot.wins.filter((w) => w.status !== "cancelled").length} />
    </main>
  );
}
