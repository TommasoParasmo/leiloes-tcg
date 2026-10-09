import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav, StoreLink } from "@/components/admin/admin-nav";
import { OrdersBoard } from "@/components/admin/orders-board";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { fetchOrders } from "@/lib/orders";

export const metadata: Metadata = { title: "Pedidos · Painel · Bate Carta" };

export default function PedidosAdminPage() {
  return (
    <>
      <AppBar right={<StoreLink />} />
      <AdminNav active="pedidos" />
      <Suspense fallback={<PageLoading />}>
        <Pedidos />
      </Suspense>
    </>
  );
}

async function Pedidos() {
  const { sb, sellerId } = await requireAdmin("/painel/pedidos");
  const orders = await fetchOrders(sb, { sellerId });
  // horário da leitura, para marcar Pix vencido igual no servidor e no navegador
  const readAt = new Date();
  return <OrdersBoard orders={orders} now={readAt.getTime()} />;
}
