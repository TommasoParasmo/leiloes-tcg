"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { LABEL_SERVICES, labelIsPaid, serviceIdFromName, type LabelServiceId } from "@/lib/superfrete";

/** Painel do SuperFrete onde o leiloeiro paga as etiquetas do carrinho. */
export const SUPERFRETE_APP_URL = "https://web.superfrete.com";

const MESSAGES: Record<string, string> = {
  sender_required: "Cadastre o endereço de quem envia em Minha loja para gerar a etiqueta.",
  address_required: "O pedido não tem endereço de entrega.",
  order_wrong_status: "A etiqueta só sai para pedido pago.",
  service_required: "Escolha PAC, SEDEX ou Mini Envios.",
  label_exists: "Este pedido já tem etiqueta no SuperFrete. Toque em Atualizar.",
  label_missing: "Este pedido ainda não tem etiqueta.",
  label_not_saved: "A etiqueta foi para o carrinho do SuperFrete, mas não ficou salva aqui. Não gere outra: pague a que está lá.",
  superfrete_not_configured: "O SuperFrete não está configurado no site (falta o token na Vercel).",
  superfrete_rejected: "O SuperFrete recusou o token. Gere um novo no painel do SuperFrete e troque na Vercel.",
  superfrete_invalid: "O SuperFrete recusou os dados da etiqueta.",
  superfrete_unavailable: "O SuperFrete não respondeu. Tente de novo.",
  forbidden: "Você não tem permissão para isso.",
};

type Label = { status: string; url: string | null; tracking: string | null };

/** Etiqueta no carrinho do SuperFrete: o site cria, o leiloeiro paga lá, e o site traz o rastreio e o PDF. */
export function SuperfreteLabel({
  orderId,
  serviceName,
  onTracking,
}: {
  orderId: string;
  serviceName: string | null;
  /** rastreio que veio do SuperFrete: preenche o campo do envio */
  onTracking: (code: string) => void;
}) {
  const [label, setLabel] = useState<Label | null | undefined>(undefined);
  const [service, setService] = useState<LabelServiceId | null>(() => serviceIdFromName(serviceName));
  const [busy, setBusy] = useState<"create" | "refresh" | null>(null);
  const [error, setError] = useState<{ code: string; detail?: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    createClient()
      .from("order_labels")
      .select("status, label_url, tracking_code")
      .eq("order_id", orderId)
      .maybeSingle<{ status: string; label_url: string | null; tracking_code: string | null }>()
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setLabel(null);
        setLabel(data ? { status: data.status, url: data.label_url, tracking: data.tracking_code } : null);
        if (data?.tracking_code) onTracking(data.tracking_code);
      });
    return () => {
      live = false;
    };
    // só ao abrir: onTracking muda a cada render do formulário
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function send(action: "create" | "refresh") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/etiqueta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, action, service }),
      });
      const data = (await res.json()) as { ok: boolean; code: string; detail?: string | null; status?: string; tracking?: string | null; url?: string | null };
      if (!data.ok) {
        setError({ code: data.code, detail: data.detail });
        if (data.code === "label_exists" || data.code === "label_not_saved") setLabel((l) => l ?? { status: "pending", url: null, tracking: null });
      } else if (action === "create") {
        setLabel({ status: data.status ?? "pending", url: null, tracking: null });
      } else {
        setLabel({ status: data.status ?? "pending", url: data.url ?? null, tracking: data.tracking ?? null });
        if (data.tracking) onTracking(data.tracking);
      }
    } catch {
      setError({ code: "superfrete_unavailable" });
    }
    setBusy(null);
  }

  const canceled = label?.status === "canceled" || label?.status === "cancelled";
  const paid = !!label && !canceled && labelIsPaid(label.status);

  return (
    <section aria-label="Etiqueta do SuperFrete" className="flex flex-col gap-2 rounded-md border border-line p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Etiqueta do SuperFrete</p>

      {label === undefined && <p className="text-sm text-muted">Carregando…</p>}

      {(label === null || canceled) && (
        <>
          {canceled && <p className="text-sm text-muted">A etiqueta anterior foi cancelada no SuperFrete. Gere outra se precisar.</p>}
          <div role="radiogroup" aria-label="Serviço" className="grid grid-cols-3 gap-1.5">
            {LABEL_SERVICES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={service === s.id}
                onClick={() => (setService(s.id), setError(null))}
                className={cn("min-h-11 rounded-sm text-sm font-bold", service === s.id ? "bg-accent text-on-accent" : "bg-surface-2")}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void send("create")}
            disabled={busy !== null || !service}
            aria-busy={busy === "create" || undefined}
            className="min-h-11 rounded-md bg-surface-2 text-sm font-bold disabled:text-muted"
          >
            {busy === "create" ? "Mandando para o SuperFrete…" : "Mandar para o carrinho do SuperFrete"}
          </button>
          <p className="text-xs text-muted">Nada é pago aqui: a etiqueta fica no seu carrinho do SuperFrete.</p>
        </>
      )}

      {label && !canceled && !paid && (
        <>
          <p className="text-sm">
            A etiqueta está no seu carrinho do SuperFrete. Pague lá e depois toque em <strong>Atualizar</strong> para trazer o rastreio.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <a href={SUPERFRETE_APP_URL} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-md bg-surface-2 text-sm font-bold">
              Abrir o SuperFrete
            </a>
            <RefreshButton busy={busy} onClick={() => void send("refresh")} />
          </div>
        </>
      )}

      {paid && label && (
        <>
          <p className="text-sm">
            Etiqueta paga{label.tracking ? <> · rastreio <strong className="tabular">{label.tracking}</strong></> : null}.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {label.url ? (
              <a href={label.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-md bg-accent text-sm font-bold text-on-accent">
                Imprimir etiqueta
              </a>
            ) : (
              <a href={SUPERFRETE_APP_URL} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-md bg-surface-2 text-sm font-bold">
                Abrir o SuperFrete
              </a>
            )}
            <RefreshButton busy={busy} onClick={() => void send("refresh")} />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {MESSAGES[error.code] ?? MESSAGES.superfrete_unavailable}
          {error.code === "superfrete_invalid" && error.detail ? ` (${error.detail})` : ""}{" "}
          {error.code === "sender_required" && (
            <Link href="/painel/loja" className="font-bold underline">
              Abrir Minha loja
            </Link>
          )}
        </p>
      )}
    </section>
  );
}

function RefreshButton({ busy, onClick }: { busy: "create" | "refresh" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null}
      aria-busy={busy === "refresh" || undefined}
      className="min-h-11 rounded-md bg-surface-2 text-sm font-bold disabled:text-muted"
    >
      {busy === "refresh" ? "Atualizando…" : "Atualizar"}
    </button>
  );
}
