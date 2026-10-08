"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { auctionMessage } from "@/lib/auction/codes";
import { CHAT_MAX_LENGTH, fetchChat, hideChat, mergeChat, sendChat, type ChatMessage } from "@/lib/chat";
import { cn } from "@/lib/cn";

function chatError(code: string): string {
  switch (code) {
    case "rate_limited":
      return "Calma: espere 2 segundos entre uma mensagem e outra";
    case "event_not_live":
      return "O chat fica aberto só com o leilão ao vivo";
    case "blocked":
      return "Sua conta está bloqueada. Fale com o leiloeiro";
    case "invalid_request":
      return `Escreva de 1 a ${CHAT_MAX_LENGTH} letras`;
    default:
      return auctionMessage({ code: code as never });
  }
}

/**
 * Chat da sala ao vivo. As mensagens novas chegam pelo canal da sala (ver useRoom);
 * ao entrar e ao reconectar, relê as últimas do servidor para não perder nenhuma.
 */
export function ChatPanel({
  sb,
  eventId,
  live,
  loggedIn,
  canModerate,
  messages,
  setMessages,
  reconnecting,
}: {
  sb: SupabaseClient;
  eventId: string;
  live: boolean;
  loggedIn: boolean;
  canModerate: boolean;
  messages: ChatMessage[];
  setMessages: (update: (current: ChatMessage[]) => ChatMessage[]) => void;
  reconnecting: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const nearBottom = useRef(true);

  // lê do servidor ao entrar e ao reconectar; sem o tempo real, continua lendo a cada 4 s
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchChat(sb, eventId)
        .then((m) => alive && setMessages(() => m))
        .catch(() => {});
    void load();
    const poll = reconnecting ? setInterval(() => document.visibilityState === "visible" && void load(), 4000) : undefined;
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [sb, eventId, reconnecting, setMessages]);

  // desce sozinho com mensagem nova, a não ser que a pessoa tenha subido para ler
  useEffect(() => {
    const el = list.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendChat(sb, eventId, body);
      if (!result.ok) setError(chatError(result.code));
      else {
        setText("");
        nearBottom.current = true;
        if (result.message) setMessages((c) => mergeChat(c, [result.message!]));
      }
    } catch {
      setError("Sem conexão. Sua mensagem não foi enviada");
    }
    setSending(false);
  }

  async function hide(m: ChatMessage) {
    try {
      const result = await hideChat(sb, m.id);
      if (result.ok) setMessages((c) => c.filter((x) => x.id !== m.id));
      else setError(chatError(result.code));
    } catch {
      setError("Sem conexão. Tente de novo");
    }
  }

  return (
    <section aria-labelledby="chat-titulo" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <h2 id="chat-titulo" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">
        Chat da sala
      </h2>
      <ol
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
        aria-relevant="additions"
        className="flex max-h-60 min-h-20 flex-col gap-1.5 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 && <li className="py-4 text-center text-sm text-muted">Ninguém falou nada ainda.</li>}
        {messages.map((m) => (
          <li key={m.id} className="flex items-start gap-2 text-sm leading-snug">
            <p className="min-w-0 flex-1 break-words">
              <b className={cn("mr-1", m.is_admin ? "text-accent-text" : "text-text")}>{m.nickname}</b>
              {m.is_admin && <span className="mr-1 rounded-pill bg-accent/15 px-1.5 py-px text-[10px] font-extrabold uppercase text-accent-text">Leiloeiro</span>}
              <span className="text-text">{m.body}</span>
            </p>
            {canModerate && !m.is_admin && (
              <button type="button" onClick={() => void hide(m)} className="-my-2 min-h-11 shrink-0 px-2 text-xs font-bold text-muted" aria-label={`Esconder mensagem de ${m.nickname}`}>
                Esconder
              </button>
            )}
          </li>
        ))}
      </ol>
      {!live ? (
        <p className="text-center text-xs text-muted">O chat abre para mensagens quando o leilão estiver ao vivo.</p>
      ) : !loggedIn ? (
        <Link href={`/entrar?next=${encodeURIComponent(`/sala/${eventId}`)}`} className="flex min-h-11 items-center justify-center rounded-md bg-surface-2 text-sm font-bold">
          Entre para conversar
        </Link>
      ) : (
        <form onSubmit={send} className="flex gap-2">
          <label htmlFor="chat-texto" className="sr-only">
            Mensagem
          </label>
          <input
            id="chat-texto"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            maxLength={CHAT_MAX_LENGTH}
            enterKeyHint="send"
            autoComplete="off"
            placeholder="Escreva para a sala"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
          />
          <button type="submit" disabled={sending || !text.trim()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-bold text-on-accent disabled:bg-surface-2 disabled:text-muted">
            Enviar
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
