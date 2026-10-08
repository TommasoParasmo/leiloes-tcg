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
      disabled: closed || state.leading_is_me || (current != null && amount <= current),
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
