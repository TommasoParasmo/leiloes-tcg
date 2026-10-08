"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { TextArea } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { adminRpc } from "@/lib/admin-data";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { cn } from "@/lib/cn";
import { formatBRL, parseBRL } from "@/lib/money";
import { formatDue, ORDER_STATUS, PROOFS_BUCKET, type Order, type OrderStatus } from "@/lib/orders";
import { createClient } from "@/lib/supabase/client";
import { formatWhatsapp } from "@/lib/validation";

type Tab = "frete" | "pix" | "comprovante" | "pagos" | "enviados" | "cancelados";
const TABS: { id: Tab; label: string; statuses: OrderStatus[] }[] = [
  { id: "frete", label: "Frete", statuses: ["awaiting_shipping_quote"] },
  { id: "pix", label: "Pix", statuses: ["awaiting_payment"] },
  { id: "comprovante", label: "Comprov.", statuses: ["proof_sent"] },
  { id: "pagos", label: "Pagos", statuses: ["paid"] },
  { id: "enviados", label: "Enviados", statuses: ["shipped", "delivered"] },
  { id: "cancelados", label: "Cancel.", statuses: ["cancelled"] },
];

type Action = { kind: "quote" | "reject" | "cancel" | "confirm" | "ship" | "deliver"; order: Order };

/** Pedidos do leiloeiro: cotar frete, conferir comprovante, confirmar o Pix e registrar o envio. */
export function OrdersBoard({ orders, now }: { orders: Order[]; now: number }) {
  const router = useRouter();
  const [sb] = useState(createClient);
  const [tab, setTab] = useState<Tab>(() => (orders.some((o) => o.status === "proof_sent") ? "comprovante" : "frete"));
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const late = (o: Order) => o.status === "awaiting_payment" && !!o.due_at && Date.parse(o.due_at) < now;
  const sum = (f: (o: Order) => boolean) => orders.filter(f).reduce((acc, o) => acc + o.total_cents, 0);
  const totals = [
    { label: "Recebido", value: sum((o) => ["paid", "shipped", "delivered"].includes(o.status)), tone: "text-win" },
    { label: "A receber", value: sum((o) => ["awaiting_shipping_quote", "awaiting_payment", "proof_sent"].includes(o.status) && !late(o)), tone: "text-text" },
    { label: "Vencido", value: sum(late), tone: "text-danger" },
  ];
  const current = TABS.find((t) => t.id === tab)!;
  const shown = orders.filter((o) => current.statuses.includes(o.status));

  async function viewProof(o: Order) {
    if (!o.payment?.proof_path) return;
    const { data } = await sb.storage.from(PROOFS_BUCKET).createSignedUrl(o.payment.proof_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else setMessage("Não foi possível abrir o comprovante. Tente de novo.");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-3">
      <section className="grid grid-cols-3 gap-2" aria-label="Totais">
        {totals.map((t) => (
          <div key={t.label} className="rounded-md border border-line bg-surface p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">{t.label}</p>
            <p className={cn("mt-0.5 font-display text-sm font-bold tabular", t.tone)}>{formatBRL(t.value)}</p>
          </div>
        ))}
      </section>

      <div role="tablist" aria-label="Situação dos pedidos" className="grid grid-cols-6 gap-0.5 rounded-md bg-surface p-1">
        {TABS.map((t) => {
          const n = orders.filter((o) => t.statuses.includes(o.status)).length;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("flex min-h-11 flex-col items-center justify-center rounded-sm text-[12px] font-bold leading-tight", tab === t.id ? "bg-surface-2 text-text" : "text-muted")}
            >
              {t.label}
              <span className="tabular text-[11px] opacity-80">{n}</span>
            </button>
          );
        })}
      </div>

      <p aria-live="polite" className={message ? "rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win" : "sr-only"}>
        {message ?? ""}
      </p>

      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">Nenhum pedido aqui.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold">{o.buyer?.nickname ?? "Comprador"}</p>
                <p className="truncate text-xs text-muted">{o.items.map((i) => i.card_name).join(", ")}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold tabular">{formatBRL(o.total_cents)}</p>
                <Pill tone={late(o) ? "danger" : ORDER_STATUS[o.status].tone}>{late(o) ? "Vencido" : ORDER_STATUS[o.status].label}</Pill>
              </div>
            </div>
            <p className="text-xs text-muted">
              {o.items.length} {o.items.length === 1 ? "carta" : "cartas"} · {formatBRL(o.subtotal_cents)}
              {o.shipping_cents != null ? ` + frete ${formatBRL(o.shipping_cents)}` : ""}
              {o.due_at && ["awaiting_payment", "proof_sent"].includes(o.status) ? ` · vence ${formatDue(o.due_at)}` : ""}
              {o.shipment?.tracking_code ? ` · rastreio ${o.shipment.tracking_code}` : ""}
              {o.shipping_address ? ` · ${o.shipping_address.city}/${o.shipping_address.state}` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {o.status === "awaiting_shipping_quote" && <ActionButton primary onClick={() => setAction({ kind: "quote", order: o })}>Informar frete</ActionButton>}
              {o.status === "proof_sent" && (
                <>
                  <ActionButton onClick={() => void viewProof(o)}>Ver comprovante</ActionButton>
                  <ActionButton primary onClick={() => setAction({ kind: "confirm", order: o })}>Confirmar Pix</ActionButton>
                  <ActionButton onClick={() => setAction({ kind: "reject", order: o })}>Recusar</ActionButton>
                </>
              )}
              {o.status === "paid" && <ActionButton primary onClick={() => setAction({ kind: "ship", order: o })}>Marcar enviado</ActionButton>}
              {o.status === "shipped" && (
                <>
                  <ActionButton primary onClick={() => setAction({ kind: "deliver", order: o })}>Marcar entregue</ActionButton>
                  <ActionButton onClick={() => setAction({ kind: "ship", order: o })}>Mudar rastreio</ActionButton>
                </>
              )}
              {o.status === "awaiting_payment" && (
                <>
                  <ActionButton onClick={() => setAction({ kind: "confirm", order: o })}>Confirmar Pix</ActionButton>
                  <ActionButton onClick={() => setAction({ kind: "quote", order: o })}>Mudar frete</ActionButton>
                </>
              )}
              {o.buyer?.whatsapp && (
                <a
                  href={`https://wa.me/${o.buyer.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-10 items-center rounded-sm bg-surface-2 px-3 text-sm font-bold"
                  aria-label={`WhatsApp de ${o.buyer.nickname}: ${formatWhatsapp(o.buyer.whatsapp)}`}
                >
                  WhatsApp
                </a>
              )}
              {["awaiting_shipping_quote", "awaiting_payment", "proof_sent"].includes(o.status) && (
                <ActionButton danger onClick={() => setAction({ kind: "cancel", order: o })}>Cancelar</ActionButton>
              )}
            </div>
          </li>
        ))}
      </ul>

      {action && (
        <ActionSheet
          action={action}
          sb={sb}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            setMessage(text);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

function ActionButton({ primary, danger, children, onClick }: { primary?: boolean; danger?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("min-h-10 rounded-sm px-3 text-sm font-bold", primary ? "bg-accent text-on-accent" : danger ? "bg-danger/15 text-danger" : "bg-surface-2")}
    >
      {children}
    </button>
  );
}

function ActionSheet({ action, sb, onClose, onDone }: { action: Action; sb: ReturnType<typeof createClient>; onClose: () => void; onDone: (msg: string) => void }) {
  const o = action.order;
  const [price, setPrice] = useState(o.shipping_cents != null ? String(o.shipping_cents / 100).replace(".", ",") : "");
  const [service, setService] = useState(o.shipment?.service_name ?? "PAC");
  const [days, setDays] = useState(o.shipment?.delivery_days ? String(o.shipment.delivery_days) : "");
  const [reason, setReason] = useState("");
  const [tracking, setTracking] = useState(o.shipment?.tracking_code ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const who = o.buyer?.nickname ?? "comprador";

  async function run(fn: () => Promise<AuctionResult>, done: string) {
    setPending(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(auctionMessage(r));
      else return onDone(done);
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    }
    setPending(false);
  }

  if (action.kind === "quote") {
    return (
      <Sheet title={`Frete de ${who}`} onClose={onClose}>
        <p className="text-sm text-muted">
          {o.items.length} {o.items.length === 1 ? "carta" : "cartas"} para {o.shipping_address ? `${o.shipping_address.city}/${o.shipping_address.state}, CEP ${o.shipping_address.cep}` : "endereço não informado"}.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Valor do frete (R$)" inputMode="decimal" placeholder="22,90" value={price} onChange={(e) => (setPrice(e.target.value), setFieldError(null))} error={fieldError} />
          <Field label="Prazo (dias)" inputMode="numeric" placeholder="6" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
        </div>
        <Field label="Serviço" value={service} onChange={(e) => setService(e.target.value)} hint="Ex.: PAC, SEDEX, Mini Envios." maxLength={80} />
        <FormError message={error} />
        <Button
          block
          className="min-h-[52px]"
          pending={pending}
          onClick={() => {
            const cents = parseBRL(price);
            if (cents == null) return setFieldError("Informe o valor, ex.: 22,90 (0 para frete grátis)");
            void run(
              () => adminRpc(sb, "admin_quote_shipping", { p_order_id: o.id, p_price_cents: cents, p_service: service.trim() || "Frete", p_days: days ? Number(days) : null }),
              `Frete enviado. ${who} já pode pagar o Pix.`,
            );
          }}
        >
          Liberar Pix com frete
        </Button>
      </Sheet>
    );
  }

  if (action.kind === "confirm") {
    return (
      <Sheet title="Confirmar Pix?" onClose={onClose}>
        <p className="text-sm text-muted">
          Confira no app do banco se entrou {formatBRL(o.total_cents)} de {who}. Ao confirmar, o pedido vai para envio.
        </p>
        <FormError message={error} />
        <Button block variant="success" className="min-h-[52px]" pending={pending} onClick={() => void run(() => adminRpc(sb, "admin_confirm_payment", { p_order_id: o.id }), `Pix de ${who} confirmado.`)}>
          Confirmar {formatBRL(o.total_cents)}
        </Button>
      </Sheet>
    );
  }

  if (action.kind === "ship") {
    return (
      <Sheet title={`Envio de ${who}`} onClose={onClose}>
        <p className="text-sm text-muted">
          {o.items.length} {o.items.length === 1 ? "carta" : "cartas"} para{" "}
          {o.shipping_address
            ? `${o.shipping_address.street}, ${o.shipping_address.number}${o.shipping_address.complement ? ` ${o.shipping_address.complement}` : ""}, ${o.shipping_address.district}, ${o.shipping_address.city}/${o.shipping_address.state}, CEP ${o.shipping_address.cep}`
            : "endereço não informado"}
          . {who} recebe o código no app.
        </p>
        <Field
          label="Código de rastreio"
          autoCapitalize="characters"
          placeholder="AB123456789BR"
          value={tracking}
          onChange={(e) => (setTracking(e.target.value), setFieldError(null))}
          error={fieldError}
          maxLength={40}
        />
        <FormError message={error} />
        <Button
          block
          className="min-h-[52px]"
          pending={pending}
          onClick={() => {
            if (tracking.replace(/\s/g, "").length < 5) return setFieldError("Informe o código de rastreio");
            void run(() => adminRpc(sb, "admin_ship_order", { p_order_id: o.id, p_tracking_code: tracking }), `Envio de ${who} registrado.`);
          }}
        >
          {o.status === "shipped" ? "Salvar rastreio" : "Marcar como enviado"}
        </Button>
      </Sheet>
    );
  }

  if (action.kind === "deliver") {
    return (
      <Sheet title="Marcar como entregue?" onClose={onClose}>
        <p className="text-sm text-muted">Use quando o rastreio mostrar a entrega ou {who} confirmar que recebeu.</p>
        <FormError message={error} />
        <Button block variant="success" className="min-h-[52px]" pending={pending} onClick={() => void run(() => adminRpc(sb, "admin_mark_delivered", { p_order_id: o.id }), `Pedido de ${who} entregue.`)}>
          Marcar entregue
        </Button>
      </Sheet>
    );
  }

  const reject = action.kind === "reject";
  return (
    <Sheet title={reject ? "Recusar comprovante" : "Cancelar pedido"} onClose={onClose}>
      <p className="text-sm text-muted">
        {reject
          ? `${who} recebe o motivo e pode enviar outro comprovante. O prazo continua o mesmo.`
          : `As cartas voltam a ficar livres para outro evento e ${who} é avisado. Não dá para desfazer.`}
      </p>
      <TextArea label="Motivo" value={reason} onChange={(e) => (setReason(e.target.value), setFieldError(null))} maxLength={300} hint={fieldError ?? "Aparece para o comprador."} />
      <FormError message={error} />
      <Button
        block
        variant="danger"
        className="min-h-[52px]"
        pending={pending}
        onClick={() => {
          if (!reason.trim()) return setFieldError("Escreva o motivo.");
          void run(
            () => adminRpc(sb, reject ? "admin_reject_payment" : "admin_cancel_order", { p_order_id: o.id, p_reason: reason.trim() }),
            reject ? "Comprovante recusado." : "Pedido cancelado.",
          );
        }}
      >
        {reject ? "Recusar comprovante" : "Cancelar pedido"}
      </Button>
    </Sheet>
  );
}
