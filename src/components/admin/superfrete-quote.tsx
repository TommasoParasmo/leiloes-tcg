"use client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";
import type { ShippingOption } from "@/lib/superfrete";

const MESSAGES: Record<string, string> = {
  origin_required: "Cadastre o CEP de onde as cartas saem para calcular.",
  address_required: "O comprador ainda não tem endereço. Informe o frete à mão.",
  superfrete_not_configured: "O SuperFrete não está configurado no site (falta o token na Vercel).",
  superfrete_rejected: "O SuperFrete recusou o token. Gere um novo no painel do SuperFrete e troque na Vercel.",
  superfrete_unavailable: "O SuperFrete não respondeu. Tente de novo ou informe o frete à mão.",
  forbidden: "Você não tem permissão para isso.",
};

/** Cotação do SuperFrete dentro do painel de frete: tocar numa opção preenche valor, serviço e prazo. */
export function SuperfreteQuote({
  orderId,
  onPick,
  onClear,
}: {
  orderId: string;
  onPick: (o: ShippingOption) => void;
  /** a opção escolhida antes deixou de valer (nova cotação): apaga o que ela tinha preenchido */
  onClear: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function quote() {
    // cotação nova: a escolha anterior (e o valor que ela preencheu) não vale mais
    if (picked) onClear();
    setPicked(null);
    setOptions([]);
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/frete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
      const data = (await res.json()) as { ok: boolean; code: string; options?: ShippingOption[] };
      if (!data.ok) setError(data.code);
      else if (!data.options?.length) setError("superfrete_unavailable");
      else setOptions(data.options);
    } catch {
      setError("superfrete_unavailable");
    }
    setState("done");
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3">
      <button
        type="button"
        onClick={() => void quote()}
        disabled={state === "loading"}
        aria-busy={state === "loading" || undefined}
        className="min-h-11 rounded-md bg-surface-2 text-sm font-bold disabled:text-muted"
      >
        {state === "loading" ? "Calculando no SuperFrete…" : state === "done" ? "Calcular de novo" : "Calcular no SuperFrete"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {MESSAGES[error] ?? MESSAGES.superfrete_unavailable}{" "}
          {error === "origin_required" && (
            <Link href="/painel/loja" className="font-bold underline">
              Abrir Minha loja
            </Link>
          )}
        </p>
      )}
      {options.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Opções do SuperFrete">
          {options.map((o) => (
            <li key={o.serviceId + o.name}>
              <button
                type="button"
                aria-pressed={picked === o.serviceId}
                onClick={() => {
                  setPicked(o.serviceId);
                  onPick(o);
                }}
                className={cn(
                  "flex min-h-12 w-full items-center justify-between rounded-md border px-3 text-left text-sm",
                  picked === o.serviceId ? "border-accent bg-accent/10" : "border-line bg-surface",
                )}
              >
                <span className="font-bold">{o.name}</span>
                <span className="tabular text-muted">
                  {o.days ? `${o.days} ${o.days === 1 ? "dia" : "dias"} · ` : ""}
                  <b className="text-text">{formatBRL(o.priceCents)}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
