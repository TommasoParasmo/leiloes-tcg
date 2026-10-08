import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { Pill } from "@/components/ui/pill";
import { formatBRL } from "@/lib/money";
import { fetchOrders, formatDue, ORDER_STATUS } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Meus pedidos · Bate Carta" };

export default function PedidosPage() {
  return (
    <>
      <AppBar back="/conta" title="Meus pedidos" />
      <Suspense fallback={<PageLoading />}>
        <Pedidos />
      </Suspense>
    </>
  );
}

async function Pedidos() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/entrar?next=/conta/pedidos");
  const orders = await fetchOrders(sb, { userId: data.user.id });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 pb-10 pt-2">
      {orders.length === 0 && (
        <section className="rounded-md border border-line bg-surface p-4 text-center text-sm text-muted">
          Nenhum pedido ainda. Pedidos aparecem quando você fecha um lote.
          <Link href="/conta/lote" className="mt-3 flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold text-text">
            Ver meu lote
          </Link>
        </section>
      )}
      {orders.map((o) => {
        const s = ORDER_STATUS[o.status];
        const late = o.status === "awaiting_payment" && o.due_at && new Date(o.due_at) < new Date();
        return (
          <Link key={o.id} href={`/conta/pedidos/${o.id}`} className="flex flex-col gap-1 rounded-md border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">
                {o.items.length} {o.items.length === 1 ? "carta" : "cartas"} · {formatBRL(o.total_cents)}
              </span>
              <Pill tone={late ? "danger" : s.tone}>{late ? "Pix vencido" : s.label}</Pill>
            </div>
            <span className="truncate text-xs text-muted">{o.items.map((i) => i.card_name).join(", ")}</span>
            {o.status === "awaiting_payment" && o.due_at && <span className="text-xs font-semibold text-warn">Pague até {formatDue(o.due_at)}</span>}
          </Link>
        );
      })}
    </main>
  );
}
