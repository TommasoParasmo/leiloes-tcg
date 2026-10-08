import type { RoundState } from "./types";

/**
 * Regras de exibição da sala. Nenhuma decide resultado: o servidor valida tudo.
 * Elas só montam os botões e o cronômetro a partir do estado que o servidor mandou.
 */

export interface BidChoice {
  amount_cents: number;
  /** Incremento sobre o lance atual (null no primeiro lance ou em opções fixas). */
  increment_cents: number | null;
  disabled: boolean;
  primary: boolean;
}

/** Botões de lance para o estado atual (modo maior lance). */
export function bidChoices(state: RoundState): BidChoice[] {
  if (state.mode !== "highest_bid") return [];
  const closed = state.status !== "open";

  if (state.bid_options_cents?.length) {
    const current = state.current_amount_cents;
    const options = [...state.bid_options_cents].sort((a, b) => a - b);
    // Valor igual ao atual é aceito pelo servidor, mas não lidera (empate: vale o primeiro).
    // Na interface mostramos só as opções que podem liderar.
    const firstValid = options.find((o) => current == null || o > current);
    return options.map((amount) => ({
      amount_cents: amount,
      increment_cents: null,
      // quem lidera ainda pode tocar no valor que arremata na hora
      disabled: closed || (state.leading_is_me && !(state.fixed_price_cents != null && amount >= state.fixed_price_cents)) || (current != null && amount <= current),
      primary: amount === firstValid,
    }));
  }

  const increments = [...(state.increments_cents ?? [])].sort((a, b) => a - b);
  if (state.current_amount_cents == null) {
    const start = state.start_price_cents ?? 0;
    const firsts = [start, ...increments.map((i) => start + i)].slice(0, 3);
    return firsts.map((amount, i) => ({
      amount_cents: amount,
      increment_cents: i === 0 ? null : amount - start,
      disabled: closed,
      primary: i === 0,
    }));
  }
  return increments.slice(0, 3).map((inc, i) => ({
    amount_cents: state.current_amount_cents! + inc,
    increment_cents: inc,
    disabled: closed || state.leading_is_me,
    primary: i === 0,
  }));
}

/** Diferença entre o relógio do servidor e o do aparelho, em ms (servidor − local). */
export function clockOffsetMs(serverNowIso: string, receivedAtLocalMs: number): number {
  return Date.parse(serverNowIso) - receivedAtLocalMs;
}

export interface ClockSync {
  offsetMs: number;
  /** Ida e volta da medição usada; medições mais rápidas são mais precisas. */
  rttMs: number;
}

/**
 * Nova estimativa do relógio do servidor a partir de uma resposta com ida e volta conhecida.
 * O servidor carimbou o horário mais ou menos no meio do caminho, então a latência é
 * descontada. Medições bem mais lentas que a melhor recente são ignoradas (a rede
 * oscilou), para o cronômetro não pular décimos; a tolerância cresce aos poucos para
 * acompanhar uma rede que ficou mais lenta de vez.
 */
export function nextClockSync(prev: ClockSync | null, serverNowIso: string, sentAtMs: number, receivedAtMs: number): ClockSync {
  const rtt = Math.max(0, receivedAtMs - sentAtMs);
  const sample = { offsetMs: Date.parse(serverNowIso) - (sentAtMs + rtt / 2), rttMs: rtt };
  if (!prev) return sample;
  if (rtt <= prev.rttMs * 1.25 + 20) return sample;
  return { offsetMs: prev.offsetMs, rttMs: prev.rttMs * 1.1 };
}

/**
 * Junta um estado público (transmitido pelo canal da sala, igual para todos) com os
 * campos pessoais que esta tela já tinha da mesma rodada. A liderança é reconhecida
 * pelo apelido, que é único.
 */
export function mergePublicState(prev: RoundState, pub: RoundState): RoundState {
  const me = prev.my_nickname;
  // mesmo líder e mesmo valor (ex.: só o cronômetro mudou): mantém o que o servidor já disse,
  // mesmo que o líder tenha trocado de apelido depois de assumir a liderança
  const sameLead = pub.id === prev.id && pub.current_amount_cents === prev.current_amount_cents && pub.leading_nickname === prev.leading_nickname;
  const leadingIsMe = sameLead ? prev.leading_is_me : me != null && pub.leading_nickname === me;
  return {
    ...pub,
    my_nickname: me,
    my_block: prev.my_block,
    leading_is_me: leadingIsMe,
    my_best_bid_cents:
      leadingIsMe && pub.current_amount_cents != null ? Math.max(prev.my_best_bid_cents ?? 0, pub.current_amount_cents) : prev.my_best_bid_cents,
    recent_bids: pub.recent_bids.map((b) => ({ ...b, is_me: me != null && b.nickname === me })),
  };
}

/** Tempo restante em ms, usando o relógio do servidor corrigido. null = sem cronômetro. */
export function remainingMs(state: RoundState, localNowMs: number, offsetMs: number): number | null {
  if (state.status === "paused") return state.paused_remaining_ms;
  if (state.status !== "open" || !state.ends_at) return null;
  return Math.max(0, Date.parse(state.ends_at) - (localNowMs + offsetMs));
}

/** Fração do cronômetro já consumida (0–1) para a barra de progresso. */
export function timerProgress(state: RoundState, remaining: number | null): number {
  if (remaining == null || !state.duration_seconds) return 0;
  const total = state.duration_seconds * 1000;
  return Math.min(1, Math.max(0, 1 - remaining / total));
}

/** "00:18", "1:05:00" */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type BidBoxTone = "neutral" | "leading" | "outbid" | "ending";

/**
 * Tom da caixa de lance (design §5 BidBox). "outbid" quando o usuário já lançou nesta
 * rodada e não lidera mais; "ending" nos últimos 10 s.
 */
export function bidBoxTone(state: RoundState, remaining: number | null): BidBoxTone {
  if (state.status === "open" && state.leading_is_me) return "leading";
  if (state.status === "open" && state.my_best_bid_cents != null) return "outbid";
  if (remaining != null && remaining <= 10_000 && state.status === "open") return "ending";
  return "neutral";
}

/** Horário do servidor em pt-BR com segundos (e milissegundos, para rapidez). */
export function formatServerTime(iso: string, withMs = false): string {
  const d = new Date(iso);
  const base = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
  return withMs ? `${base}.${String(d.getMilliseconds()).padStart(3, "0")}` : base;
}

/** Chave de idempotência por toque (reenvio após reconexão usa a mesma chave). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const EVENT_STATUS_RANK: Record<string, number> = { draft: 0, scheduled: 1, live: 2, finished: 3, cancelled: 3 };

/** O status do evento só avança: uma leitura antiga (ainda "ao vivo") não desfaz o "encerrado" que chegou pelo canal. */
export function nextEventStatus<T extends string>(prev: T | null, next: T): T {
  if (prev == null) return next;
  return (EVENT_STATUS_RANK[next] ?? 0) >= (EVENT_STATUS_RANK[prev] ?? 0) ? next : prev;
}
