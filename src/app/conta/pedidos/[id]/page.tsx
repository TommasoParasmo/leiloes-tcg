import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PaymentBox } from "@/components/buyer/payment-box";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { Pill } from "@/components/ui/pill";
import { formatBRL } from "@/lib/money";
import { fetchOrder, formatDue, ORDER_STATUS } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { formatCep } from "@/lib/validation";

export const metadata: Metadata = { title: "Pedido · Bate Carta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PedidoPage({ params }: PageProps<"/conta/pedidos/[id]">) {
  return (
    <>
      <AppBar back="/conta/pedidos" title="Pedido" />
      <Suspense fallback={<PageLoading rows={4} />}>
        <Pedido params={params} />
      </Suspense>
    </>
  );
}

async function Pedido({ params }: { params: PageProps<"/conta/pedidos/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect(`/entrar?next=/conta/pedidos/${id}`);
  const order = await fetchOrder(sb, id);
  if (!order || order.user_id !== data.user.id) notFound();
  const canPay = order.status === "awaiting_payment" || order.status === "proof_sent";
  const { data: pix } = canPay ? await sb.rpc("order_pix", { p_order_id: id }) : { data: null };
  const s = ORDER_STATUS[order.status];
  const late = order.status === "awaiting_payment" && order.due_at && new Date(order.due_at) < new Date();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
      <div className="flex items-center justify-between">
        <Pill tone={late ? "danger" : s.tone}>{late ? "Pix vencido" : s.label}</Pill>
        {order.due_at && canPay && <span className={late ? "text-sm font-bold text-danger" : "text-sm font-bold text-warn"}>Pague até {formatDue(order.due_at)}</span>}
      </div>

      {order.status === "awaiting_shipping_quote" && (
        <p className="rounded-md bg-surface p-4 text-sm text-muted">O leiloeiro está calculando o frete. Você recebe um aviso quando o Pix estiver pronto, com pelo menos 24h para pagar.</p>
      )}
      {order.notes && order.status === "awaiting_payment" && (
        <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">Comprovante não confirmado: {order.notes}</p>
      )}
      {order.status === "proof_sent" && <p className="rounded-md bg-accent/10 p-3 text-sm">Recebemos seu aviso. O leiloeiro confere o Pix e confirma.</p>}
      {order.status === "paid" && <p className="rounded-md bg-win/10 p-3 text-sm text-win">Pagamento confirmado. Agora é com o envio.</p>}
      {order.status === "cancelled" && order.notes && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">Pedido cancelado: {order.notes}</p>}

      {canPay && order.payment && (
        <PaymentBox orderId={order.id} userId={data.user.id} totalCents={order.total_cents} pix={pix} proofSent={order.status === "proof_sent"} />
      )}

      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 font-bold">Cartas</h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((w) => (
            <li key={w.id} className="flex items-center gap-3">
              {w.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.photo_url} alt="" loading="lazy" width={36} height={50} className="h-[50px] w-9 rounded-[4px] object-cover" />
              ) : (
                <span aria-hidden className="h-[50px] w-9 rounded-[4px] bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{w.card_name}</span>
                <span className="block text-xs text-muted">{[w.card_variant, `Leilão #${w.event_number}`].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="text-sm font-bold tabular">{formatBRL(w.amount_cents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-dashed border-line pt-3 text-sm">
          <dt className="text-muted">Cartas</dt>
          <dd className="tabular">{formatBRL(order.subtotal_cents)}</dd>
          <dt className="text-muted">Frete{order.shipment?.service_name ? ` · ${order.shipment.service_name}` : ""}</dt>
          <dd className="tabular">{order.shipping_cents == null ? "a calcular" : formatBRL(order.shipping_cents)}</dd>
          <dt className="font-extrabold">Total</dt>
          <dd className="font-extrabold tabular">{formatBRL(order.total_cents)}</dd>
        </dl>
      </section>

      {order.shipping_address && (
        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-1 font-bold">Entrega</h2>
          <p className="text-muted">
            {order.shipping_address.street}, {order.shipping_address.number}
            {order.shipping_address.complement ? ` · ${order.shipping_address.complement}` : ""}
            <br />
            {order.shipping_address.district} · {order.shipping_address.city}/{order.shipping_address.state} · CEP {formatCep(order.shipping_address.cep)}
          </p>
          {order.shipment?.tracking_code && <p className="mt-2">Rastreio: {order.shipment.tracking_code}</p>}
        </section>
      )}
    </main>
  );
}
