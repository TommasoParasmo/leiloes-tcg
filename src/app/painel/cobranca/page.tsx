import type { Metadata } from "next";
import { Suspense } from "react";
import { DebtorsList } from "@/components/admin/debtors-list";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { fetchOrders } from "@/lib/orders";
import { isLate, sortDebtors } from "@/lib/painel";

export const metadata: Metadata = { title: "Quem me deve · Painel · Bate Carta" };

export default function CobrancaPage() {
  return (
    <>
      <AppBar back="/painel" title="Quem me deve" />
      <Suspense fallback={<PageLoading rows={3} />}>
        <Cobranca />
      </Suspense>
    </>
  );
}

async function Cobranca() {
  const { sb, sellerId } = await requireAdmin("/painel/cobranca");
  const orders = await fetchOrders(sb, { sellerId, statuses: ["awaiting_payment", "proof_sent", "awaiting_shipping_quote"] });
  // horário da leitura, para marcar atraso igual no servidor e no navegador
  const now = new Date().getTime();
  const debtors = sortDebtors(
    orders
      .filter((o) => o.status !== "awaiting_shipping_quote")
      .map((o) => ({
        orderId: o.id,
        nickname: o.buyer?.nickname ?? "Comprador",
        totalCents: o.total_cents,
        cards: o.items.length,
        dueAt: o.due_at,
        late: isLate(o.status, o.due_at, now),
        proofSent: o.status === "proof_sent",
      })),
  );
  const waitingShipping = orders.filter((o) => o.status === "awaiting_shipping_quote").length;
  return <DebtorsList debtors={debtors} waitingShipping={waitingShipping} />;
}
