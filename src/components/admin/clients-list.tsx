"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { TextArea } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { adminRpc } from "@/lib/admin-data";
import { auctionMessage } from "@/lib/auction/codes";
import { cn } from "@/lib/cn";
import { formatBRL } from "@/lib/money";
import { formatDue } from "@/lib/orders";
import { createClient } from "@/lib/supabase/client";

export interface Client {
  id: string;
  nickname: string;
  fullName: string;
  whatsapp: string;
  blocked: boolean;
  /** Lote aberto (cartas guardadas), para o leiloeiro fechar. */
  openLotId: string | null;
  storedCards: number;
  storedCents: number;
  stored: { name: string; eventNumber: number; amountCents: number }[];
  penalties: { id: string; reason: string; issuedAt: string }[];
}

type Filter = "guardadas" | "amarelos" | "bloqueados" | "todos";
const FILTERS: { id: Filter; label: string; test: (c: Client) => boolean }[] = [
  { id: "guardadas", label: "Com cartas", test: (c) => c.storedCards > 0 },
  { id: "amarelos", label: "Cartão amarelo", test: (c) => c.penalties.length > 0 },
  { id: "bloqueados", label: "Bloqueados", test: (c) => c.blocked },
  { id: "todos", label: "Todos", test: () => true },
];

type Action = { kind: "unblock"; client: Client } | { kind: "remove"; client: Client; penaltyId: string } | { kind: "close"; client: Client; lotId: string };

/** Compradores da loja: cartas guardadas, cartões amarelos e desbloqueio com justificativa. */
export function ClientsList({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [sb] = useState(createClient);
  const [filter, setFilter] = useState<Filter>("guardadas");
  const [action, setAction] = useState<Action | null>(null);
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const shown = clients.filter(FILTERS.find((f) => f.id === filter)!.test);

  function open(a: Action) {
    setAction(a);
    setJustification("");
    setError(null);
  }

  async function submit() {
    if (!action) return;
    if (action.kind === "close") return closeLot(action.client, action.lotId);
    if (justification.trim().length < 5) return setError("Escreva a justificativa (mínimo 5 letras). Ela fica registrada.");
    setPending(true);
    setError(null);
    try {
      const r =
        action.kind === "unblock"
          ? await adminRpc(sb, "admin_unblock_user", { p_user_id: action.client.id, p_justification: justification.trim() })
          : await adminRpc(sb, "admin_remove_penalty", { p_penalty_id: action.penaltyId, p_justification: justification.trim() });
      if (!r.ok) setError(auctionMessage(r));
      else {
        setMessage(action.kind === "unblock" ? `${action.client.nickname} foi desbloqueado.` : "Cartão amarelo retirado.");
        setAction(null);
        router.refresh();
      }
    } catch {
      setError("Sem conexão com o servidor. Nada foi alterado.");
    }
    setPending(false);
  }

  async function closeLot(client: Client, lotId: string) {
    setPending(true);
    setError(null);
    try {
      const r = await adminRpc(sb, "admin_close_lot", { p_lot_id: lotId });
      if (!r.ok) setError(auctionMessage(r));
      else {
        setMessage(`Lote de ${client.nickname} fechado. O pedido está em Pedidos › Frete.`);
        setAction(null);
        router.refresh();
      }
    } catch {
      setError("Sem conexão com o servidor. Nada foi alterado.");
    }
    setPending(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar compradores">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn("min-h-10 rounded-full border px-3 text-sm font-bold", filter === f.id ? "border-accent bg-accent/15" : "border-line bg-surface text-muted")}
          >
            {f.label} <span className="tabular opacity-80">{clients.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      <p aria-live="polite" className={message ? "rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win" : "sr-only"}>
        {message ?? ""}
      </p>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">Ninguém aqui.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold">{c.nickname}</p>
                <p className="truncate text-xs text-muted">{c.fullName}</p>
              </div>
              {c.blocked ? <Pill tone="danger">Bloqueado</Pill> : c.penalties.length ? <Pill tone="warn">{c.penalties.length} amarelo</Pill> : null}
            </div>
            {c.storedCards > 0 && (
              <details className="group rounded-sm bg-surface-2/60 px-2.5 py-1.5">
                <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-sm">
                  <span>
                    {c.storedCards} {c.storedCards === 1 ? "carta guardada" : "cartas guardadas"} · <b className="tabular">{formatBRL(c.storedCents)}</b>
                  </span>
                  <span aria-hidden className="text-xs text-muted transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <ul className="flex flex-col gap-1 pb-1 pt-1 text-xs">
                  {c.stored.map((s, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {s.name} <span className="text-muted">· #{s.eventNumber}</span>
                      </span>
                      <span className="shrink-0 tabular">{formatBRL(s.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {c.penalties.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-sm bg-warn/10 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 text-warn">
                  {p.reason} · {formatDue(p.issuedAt)}
                </span>
                <button type="button" className="min-h-9 shrink-0 px-1 font-bold" onClick={() => open({ kind: "remove", client: c, penaltyId: p.id })}>
                  Retirar
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              <a
                href={`https://wa.me/${c.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-10 items-center rounded-sm bg-surface-2 px-3 text-sm font-bold"
              >
                WhatsApp
              </a>
              {c.openLotId && c.storedCards > 0 && (
                <button type="button" onClick={() => open({ kind: "close", client: c, lotId: c.openLotId! })} className="min-h-10 rounded-sm bg-surface-2 px-3 text-sm font-bold">
                  Fechar lote
                </button>
              )}
              {c.blocked && (
                <button type="button" onClick={() => open({ kind: "unblock", client: c })} className="min-h-10 rounded-sm bg-accent px-3 text-sm font-bold text-on-accent">
                  Desbloquear
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {action?.kind === "close" && (
        <Sheet title={`Fechar o lote de ${action.client.nickname}?`} onClose={() => !pending && setAction(null)}>
          <p className="text-sm text-muted">
            {action.client.storedCards} {action.client.storedCards === 1 ? "carta" : "cartas"} ({formatBRL(action.client.storedCents)}) viram um pedido. Depois você informa o frete
            em Pedidos e o comprador recebe o Pix. Não dá para desfazer.
          </p>
          <FormError message={error} />
          <Button block className="min-h-[52px]" pending={pending} onClick={() => void submit()}>
            Fechar lote
          </Button>
        </Sheet>
      )}
      {action && action.kind !== "close" && (
        <Sheet title={action.kind === "unblock" ? `Desbloquear ${action.client.nickname}?` : "Retirar cartão amarelo?"} onClose={() => !pending && setAction(null)}>
          <p className="text-sm text-muted">
            {action.kind === "unblock"
              ? "A conta volta a poder dar lances. Os cartões amarelos continuam no histórico; um novo atraso bloqueia de novo."
              : "O cartão sai da contagem. Use quando o atraso não foi culpa do comprador."}
          </p>
          <TextArea label="Justificativa" value={justification} onChange={(e) => (setJustification(e.target.value), setError(null))} maxLength={500} hint="Obrigatória. Fica registrada na auditoria." />
          <FormError message={error} />
          <Button block className="min-h-[52px]" pending={pending} onClick={() => void submit()}>
            {action.kind === "unblock" ? "Desbloquear" : "Retirar cartão"}
          </Button>
        </Sheet>
      )}
    </main>
  );
}
