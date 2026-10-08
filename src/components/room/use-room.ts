"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCard, fetchRoomState } from "@/lib/auction/data";
import { clockOffsetMs, mergePublicState, nextClockSync, nextEventStatus, type ClockSync } from "@/lib/auction/logic";
import type { CardInfo, EventInfo, RoundState } from "@/lib/auction/types";
import type { ChatEvent, ChatMessage } from "@/lib/chat";

/** Sem o tempo real, a sala relê o servidor neste intervalo. */
const OFFLINE_POLL_MS = 4000;
/** Com o tempo real funcionando, só uma conferência de vez em quando. */
const ONLINE_POLL_MS = 20000;

export interface RoomData {
  round: RoundState | null;
  card: CardInfo | null;
  eventStatus: EventInfo["status"] | null;
  offsetMs: number;
  reconnecting: boolean;
  /**
   * Aplica um estado pessoal devolvido por place_bid/buy_now/admin_*. Com `sentAtMs`
   * (quando a chamada saiu), a resposta também acerta o relógio do servidor.
   */
  applyState: (s: RoundState, sentAtMs?: number) => void;
  refresh: () => Promise<void>;
}

/**
 * Estado ao vivo da sala de um evento. A fonte da verdade é sempre o servidor.
 * Cada mudança na rodada chega pronta pelo canal da sala (igual para todos, sem dados
 * pessoais); a leitura pessoal só acontece ao entrar, ao trocar de carta, ao dar lance
 * e numa conferência periódica. Reconectar, voltar para a aba ou perder um aviso
 * nunca perde lances.
 */
export function useRoom(
  sb: SupabaseClient,
  eventId: string,
  initial: {
    round: RoundState | null;
    card: CardInfo | null;
    eventStatus?: EventInfo["status"];
  },
  /** Chat da sala: chega pelo mesmo canal, sem abrir outra conexão. */
  onChat?: (e: ChatEvent) => void,
): RoomData {
  const onChatRef = useRef(onChat);
  useEffect(() => {
    onChatRef.current = onChat;
  });
  const [round, setRound] = useState(initial.round);
  const [card, setCard] = useState(initial.card);
  const [eventStatus, setEventStatus] = useState<EventInfo["status"] | null>(initial.eventStatus ?? initial.round?.event_status ?? null);
  const [offsetMs, setOffset] = useState(() => (initial.round ? clockOffsetMs(initial.round.server_now, Date.now()) : 0));
  const [reconnecting, setReconnecting] = useState(false);
  const roundRef = useRef(initial.round);
  const cardIdRef = useRef(initial.card?.id ?? null);
  const latestServerNow = useRef(initial.round ? Date.parse(initial.round.server_now) : 0);
  const clock = useRef<ClockSync | null>(null);
  const live = useRef(false);
  const lastRead = useRef(0);

  // Mesma rodada: vale a versão (aviso atrasado nunca volta a tela). Rodada diferente:
  // vale o relógio do servidor (leitura antiga não volta para a carta anterior).
  const isStale = useCallback((s: RoundState) => {
    const cur = roundRef.current;
    if (cur && cur.id === s.id) return s.rev < cur.rev;
    return Date.parse(s.server_now) < latestServerNow.current;
  }, []);

  const commit = useCallback((s: RoundState) => {
    latestServerNow.current = Math.max(latestServerNow.current, Date.parse(s.server_now));
    roundRef.current = s;
    setRound(s);
    if (s.event_status) setEventStatus((prev) => nextEventStatus(prev, s.event_status));
  }, []);

  const applyState = useCallback(
    (s: RoundState, sentAtMs?: number) => {
      if (sentAtMs != null) {
        clock.current = nextClockSync(clock.current, s.server_now, sentAtMs, Date.now());
        setOffset(clock.current.offsetMs);
      }
      if (isStale(s)) return;
      commit(s);
    },
    [isStale, commit],
  );

  const ensureCard = useCallback(
    async (s: RoundState) => {
      if (s.card_id === cardIdRef.current) return true;
      const c = await fetchCard(sb, s.card_id);
      if (isStale(s)) return false;
      cardIdRef.current = c?.id ?? null;
      setCard(c);
      return true;
    },
    [sb, isStale],
  );

  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    const res = await fetchRoomState(sb, eventId);
    lastRead.current = Date.now();
    if (!res) return;
    setEventStatus((prev) => nextEventStatus(prev, res.event_status));
    const s = res.state;
    if (!s) return;
    if (!(await ensureCard(s))) return;
    applyState(s, sentAt);
  }, [sb, eventId, ensureCard, applyState]);

  useEffect(() => {
    const fail = () => setReconnecting(true);
    const channel = sb
      .channel(`sala:${eventId}`)
      .on("broadcast", { event: "round" }, ({ payload }) => {
        const pub = payload as RoundState;
        const cur = roundRef.current;
        if (cur && cur.id === pub.id) {
          if (!isStale(pub)) commit(mergePublicState(cur, pub));
        } else if (!cur || pub.status === "open" || pub.status === "paused") {
          // carta nova: lê o estado pessoal dela (bloqueio, apelido) uma vez
          void refresh().catch(fail);
        }
      })
      .on("broadcast", { event: "event" }, ({ payload }) => {
        setEventStatus((prev) => nextEventStatus(prev, (payload as { event_status: EventInfo["status"] }).event_status));
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        onChatRef.current?.({ type: "message", message: payload as ChatMessage });
      })
      .on("broadcast", { event: "chat_hide" }, ({ payload }) => {
        onChatRef.current?.({ type: "hide", id: (payload as { id: string }).id });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          live.current = true;
          setReconnecting(false);
          void refresh().catch(fail);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          live.current = false;
          setReconnecting(true);
        }
      });

    const onVisible = () => document.visibilityState === "visible" && void refresh().catch(fail);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    // leitura já na montagem: o painel começa sem estado, e a página pode vir do cache do
    // navegador (ex.: voltando do cadastro com o CPF, o "Falta seu CPF" precisa sumir na hora)
    const first = setTimeout(() => void refresh().catch(fail), 0);

    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const every = live.current ? ONLINE_POLL_MS : OFFLINE_POLL_MS;
      if (Date.now() - lastRead.current >= every - 500) void refresh().catch(fail);
    }, OFFLINE_POLL_MS);

    return () => {
      clearTimeout(first);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void sb.removeChannel(channel);
    };
  }, [sb, eventId, refresh, isStale, commit]);

  return {
    round,
    card,
    eventStatus,
    offsetMs,
    reconnecting,
    applyState,
    refresh,
  };
}

/** Relógio local que atualiza a cada 250 ms enquanto houver cronômetro. */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Quando o cronômetro zera, pede ao servidor para fechar a rodada (uma vez por rodada).
 * O servidor só fecha se o relógio dele confirmar; o agendador do banco é a reserva.
 */
export function useCloseWhenExpired(sb: SupabaseClient, round: RoundState | null, remaining: number | null, applyState: (s: RoundState, sentAtMs?: number) => void) {
  const asked = useRef<string | null>(null);
  const expired = round?.status === "open" && round.close_mode === "timer" && remaining === 0;
  const roundId = round?.id;
  useEffect(() => {
    if (!expired || !roundId || asked.current === roundId) return;
    asked.current = roundId;
    // pequena folga para o relógio do aparelho não chegar antes do servidor
    const t = setTimeout(async () => {
      const sentAt = Date.now();
      const { data } = await sb.rpc("close_round_if_expired", { p_round_id: roundId });
      const state = (data as { state?: RoundState } | null)?.state;
      if (state) applyState(state, sentAt);
      else asked.current = null;
    }, 300);
    return () => clearTimeout(t);
  }, [expired, roundId, sb, applyState]);
}
