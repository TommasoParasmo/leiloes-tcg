"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { auctionMessage } from "@/lib/auction/codes";
import { adminRpc } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { whatsappShareUrl } from "@/lib/whatsapp/message";

export interface QueueMessage {
  id: string;
  status: "pending" | "sending" | "sent" | "failed" | "manual_pending" | "cancelled";
  lastError: string | null;
  sentAt: string | null;
  text: string;
  photo: string | null;
}

type Tab = "pending" | "sent" | "failed";
const tabOf = (s: QueueMessage["status"]): Tab | null =>
  s === "sent" ? "sent" : s === "failed" ? "failed" : s === "cancelled" ? null : "pending";

/**
 * Publicação manual no grupo (design: tela 11). O resultado fica pendente até o
 * leiloeiro confirmar que publicou; nenhum envio automático sem integração oficial.
 * Com o grupo cadastrado em Minha loja, o botão copia o texto e abre o grupo (o WhatsApp
 * não aceita texto pronto em link de grupo); sem ele, abre o WhatsApp para escolher a conversa.
 */
export function WhatsappQueue({ initial, groupUrl }: { initial: QueueMessage[]; groupUrl: string | null }) {
  const [sb] = useState(createClient);
  const [messages, setMessages] = useState(initial);
  const [tab, setTab] = useState<Tab>("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const count = (t: Tab) => messages.filter((m) => tabOf(m.status) === t).length;
  const shown = messages.filter((m) => tabOf(m.status) === tab);

  async function mark(id: string, sent: boolean) {
    setBusy(id);
    setError(null);
    try {
      const r = await adminRpc(sb, "admin_whatsapp_mark", { p_message_id: id, p_sent: sent, p_error: null });
      if (!r.ok) setError(auctionMessage(r));
      else setMessages((list) => list.map((m) => (m.id === id ? { ...m, status: sent ? "sent" : "failed", sentAt: sent ? new Date().toISOString() : null } : m)));
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  async function run(id: string, fn: "admin_whatsapp_requeue" | "admin_whatsapp_dismiss") {
    setBusy(id);
    setError(null);
    try {
      const r = await adminRpc(sb, fn, { p_message_id: id });
      if (!r.ok) setError(auctionMessage(r));
      else setMessages((list) => list.map((m) => (m.id === id ? { ...m, status: fn === "admin_whatsapp_requeue" ? "manual_pending" : "cancelled", lastError: null } : m)));
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(m: QueueMessage) {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError(groupUrl ? "Não foi possível copiar sozinho. Use “Mandar com texto pronto” e escolha o grupo." : "Não foi possível copiar. Use “Abrir no WhatsApp”.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-4">
      <h1 className="sr-only">Publicação no WhatsApp</h1>
      <div role="tablist" aria-label="Situação" className="grid grid-cols-3 gap-1 rounded-md bg-surface p-1">
        {(
          [
            ["pending", "Pendentes"],
            ["sent", "Enviadas"],
            ["failed", "Erro"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("flex min-h-11 items-center justify-center gap-1 rounded-sm text-sm font-bold", tab === t ? "bg-surface-2 text-text" : "text-muted")}
          >
            {label}
            {t !== "sent" && count(t) > 0 && <span className={cn("tabular", t === "failed" && "text-danger")}>{count(t)}</span>}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {error ?? (copied ? "Mensagem copiada" : "")}
      </p>
      {error && <p className="rounded-sm bg-danger/15 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}

      {shown.length ? (
        shown.map((m) => (
          <article key={m.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
            {m.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.photo} alt="" loading="lazy" className="h-[120px] w-full rounded-sm object-cover object-[50%_30%]" />
            )}
            <pre className="whitespace-pre-wrap font-body text-sm leading-relaxed">{m.text}</pre>
            {m.status === "failed" && m.lastError && <p className="text-xs text-danger">{m.lastError}</p>}
            {tabOf(m.status) !== "sent" ? (
              <>
                {groupUrl ? (
                  <>
                    <a
                      href={groupUrl}
                      target="_blank"
                      rel="noreferrer"
                      // copia no mesmo toque (o navegador só deixa copiar durante o toque) e o link abre o grupo
                      onClick={() => void copy(m)}
                      className="flex min-h-[52px] items-center justify-center rounded-md bg-accent font-bold text-on-accent shadow-accent"
                    >
                      Copiar e abrir o grupo
                    </a>
                    <p className="text-center text-xs text-muted">
                      {copied === m.id ? "Texto copiado. No grupo, segure o campo de mensagem e toque em Colar." : "O texto vai copiado: no grupo, é só colar e enviar."}{" "}
                      {/* sem área de transferência (aparelho bloqueou), o texto pronto ainda vai por aqui */}
                      <a href={whatsappShareUrl(m.text)} target="_blank" rel="noreferrer" className="font-bold underline">
                        Mandar com texto pronto
                      </a>
                    </p>
                  </>
                ) : (
                  <>
                    <a
                      href={whatsappShareUrl(m.text)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-[52px] items-center justify-center rounded-md bg-accent font-bold text-on-accent shadow-accent"
                    >
                      Abrir no WhatsApp
                    </a>
                    <p className="text-center text-xs text-muted">
                      Para abrir direto no grupo,{" "}
                      <Link href="/painel/loja" className="font-bold underline">
                        cadastre o link em Minha loja
                      </Link>
                      .
                    </p>
                  </>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => copy(m)}>
                    {copied === m.id ? "Copiada" : "Copiar texto"}
                  </Button>
                  <Button variant="outline" pending={busy === m.id} disabled={!!busy} onClick={() => mark(m.id, true)}>
                    Já publiquei
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {m.status === "failed" ? (
                    <button type="button" disabled={!!busy} onClick={() => run(m.id, "admin_whatsapp_requeue")} className="min-h-11 text-xs font-bold text-muted">
                      Voltar para pendentes
                    </button>
                  ) : (
                    <button type="button" disabled={!!busy} onClick={() => mark(m.id, false)} className="min-h-11 text-xs font-bold text-muted">
                      Não consegui publicar
                    </button>
                  )}
                  <button type="button" disabled={!!busy} onClick={() => run(m.id, "admin_whatsapp_dismiss")} className="min-h-11 text-xs font-bold text-muted">
                    Não publicar
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-win">Publicada{m.sentAt ? ` em ${new Date(m.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}` : ""}</p>
            )}
          </article>
        ))
      ) : (
        <p className="rounded-md border border-line bg-surface p-5 text-center text-sm text-muted">
          {tab === "pending" ? "Nada para publicar. Os resultados aparecem aqui quando uma rodada termina." : tab === "sent" ? "Nenhuma mensagem publicada ainda." : "Nenhuma mensagem com erro."}
        </p>
      )}
      <p className="text-center text-xs text-muted">Envio manual enquanto a automação do grupo não estiver disponível. O resultado fica pendente até você confirmar.</p>
    </main>
  );
}
