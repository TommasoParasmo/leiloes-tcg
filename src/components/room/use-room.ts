"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCard, fetchRoundState, pickRoomRoundId } from "@/lib/auction/data";
import { clockOffsetMs } from "@/lib/auction/logic";
import type { CardInfo, RoundState } from "@/lib/auction/types";

/** Intervalo de segurança: se o tempo real atrasar, o estado é relido do servidor. */
const SAFETY_POLL_MS = 4000;

export interface RoomData {
  round: RoundState | null;
  card: CardInfo | null;
  offsetMs: number;
  reconnecting: boolean;
  /** Aplica um estado devolvido por place_bid/buy_now (mais novo que o do tempo real). */
  applyState: (s: RoundState) => void;
  refresh: () => Promise<void>;
}

/**
 * Estado ao vivo da sala de um evento. A fonte da verdade é sempre o servidor:
 * o tempo real só avisa que algo mudou e a sala relê round_public_state().
 * Reconectar, voltar para a aba ou perder um aviso nunca perde lances.
 */
export function useRoom(sb: SupabaseClient, eventId: string, initial: { round: RoundState | null; card: CardInfo | null }): RoomData {
  const [round, setRound] = useState(initial.round);
  const [card, setCard] = useState(initial.card);
  const [offsetMs, setOffset] = useState(() => (initial.round ? clockOffsetMs(initial.round.server_now, Date.now()) : 0));
  const [reconnecting, setReconnecting] = useState(false);
  const roundIdRef = useRef(initial.round?.id ?? null);
  const cardIdRef = useRef(initial.card?.id ?? null);
  const latestServerNow = useRef(initial.round ? Date.parse(initial.round.server_now) : 0);

  // Respostas fora de ordem são descartadas pelo relógio do servidor, de qualquer rodada:
  // uma leitura antiga da rodada encerrada não pode voltar a sala para a carta anterior.
  const isStale = useCallback((s: RoundState) => Date.parse(s.server_now) < latestServerNow.current, []);

  const applyState = useCallback(
    (s: RoundState) => {
      if (isStale(s)) return;
      latestServerNow.current = Date.parse(s.server_now);
      roundIdRef.current = s.id;
      setOffset(clockOffsetMs(s.server_now, Date.now()));
      setRound(s);
    },
    [isStale],
  );

  const loadRound = useCallback(
    async (roundId: string) => {
      const s = await fetchRoundState(sb, roundId);
      if (!s || isStale(s)) return;
      if (s.card_id !== cardIdRef.current) {
        const c = await fetchCard(sb, s.card_id);
        if (isStale(s)) return;
        cardIdRef.current = c?.id ?? null;
        setCard(c);
      }
      applyState(s);
    },
    [sb, applyState, isStale],
  );

  const refresh = useCallback(async () => {
    const id = await pickRoomRoundId(sb, eventId);
    if (id) await loadRound(id);
  }, [sb, eventId, loadRound]);

  useEffect(() => {
    const channel = sb
      .channel(`sala:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `event_id=eq.${eventId}` }, (payload) => {
        const row = payload.new as { id?: string; status?: string } | undefined;
        if (!row?.id) return;
        if (row.id === roundIdRef.current || row.status === "open" || row.status === "paused") {
          void loadRound(row.id).catch(() => setReconnecting(true));
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setReconnecting(false);
          void refresh().catch(() => setReconnecting(true));
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setReconnecting(true);
        }
      });

    const onVisible = () => document.visibilityState === "visible" && void refresh().catch(() => setReconnecting(true));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => setReconnecting(true));
    }, SAFETY_POLL_MS);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void sb.removeChannel(channel);
    };
  }, [sb, eventId, loadRound, refresh]);

  return { round, card, offsetMs, reconnecting, applyState, refresh };
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
