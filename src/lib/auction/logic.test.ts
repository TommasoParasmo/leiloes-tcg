import { describe, expect, it } from "vitest";
import { bidBoxTone, bidChoices, clockOffsetMs, formatCountdown, remainingMs, timerProgress } from "./logic";
import type { RoundState } from "./types";

const base: RoundState = {
  id: "r",
  event_id: "e",
  card_id: "c",
  position: 7,
  ordinal: 7,
  round_total: 22,
  mode: "highest_bid",
  status: "open",
  start_price_cents: 600,
  increments_cents: [500, 100, 200],
  bid_options_cents: null,
  fixed_price_cents: null,
  close_mode: "timer",
  duration_seconds: 60,
  opened_at: "2026-10-08T20:40:00.000Z",
  ends_at: "2026-10-08T20:41:00.000Z",
  paused_remaining_ms: null,
  closed_at: null,
  current_amount_cents: null,
  leading_nickname: null,
  leading_is_me: false,
  my_best_bid_cents: null,
  my_block: null,
  bid_count: 0,
  server_now: "2026-10-08T20:40:30.000Z",
  recent_bids: [],
};

describe("bidChoices", () => {
  it("primeiro lance: lance inicial e os incrementos sobre ele", () => {
    expect(bidChoices(base).map((c) => [c.amount_cents, c.increment_cents, c.primary])).toEqual([
      [600, null, true],
      [700, 100, false],
      [800, 200, false],
    ]);
  });

  it("depois do primeiro lance: atual + incrementos (R$ 10 / +1, R$ 11 / +2, R$ 14 / +5)", () => {
    const s = { ...base, current_amount_cents: 900 };
    expect(bidChoices(s).map((c) => c.amount_cents)).toEqual([1000, 1100, 1400]);
  });

  it("quem lidera não pode cobrir o próprio lance", () => {
    const s = { ...base, current_amount_cents: 900, leading_is_me: true };
    expect(bidChoices(s).every((c) => c.disabled)).toBe(true);
  });

  it("opções fixas: valores até o atual ficam desativados", () => {
    const s = { ...base, bid_options_cents: [900, 600, 700, 800], current_amount_cents: 700 };
    expect(bidChoices(s).map((c) => [c.amount_cents, c.disabled, c.primary])).toEqual([
      [600, true, false],
      [700, true, false],
      [800, false, true],
      [900, false, false],
    ]);
  });

  it("rodada fechada desativa tudo; modo rapidez não tem botões de lance", () => {
    expect(bidChoices({ ...base, status: "closed" }).every((c) => c.disabled)).toBe(true);
    expect(bidChoices({ ...base, mode: "speed" })).toEqual([]);
  });
});

describe("cronômetro", () => {
  it("usa o relógio do servidor, não o do aparelho", () => {
    // aparelho 5 s adiantado
    const local = Date.parse("2026-10-08T20:40:35.000Z");
    const offset = clockOffsetMs(base.server_now, local);
    expect(offset).toBe(-5000);
    expect(remainingMs(base, local, offset)).toBe(30_000);
  });

  it("pausado mostra o tempo congelado; manual não tem cronômetro", () => {
    expect(remainingMs({ ...base, status: "paused", ends_at: null, paused_remaining_ms: 12_000 }, 0, 0)).toBe(12_000);
    expect(remainingMs({ ...base, close_mode: "manual", ends_at: null }, 0, 0)).toBeNull();
  });

  it("formata e calcula o progresso", () => {
    expect(formatCountdown(18_000)).toBe("00:18");
    expect(formatCountdown(17_001)).toBe("00:18");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
    expect(timerProgress(base, 15_000)).toBeCloseTo(0.75);
  });
});

describe("bidBoxTone", () => {
  it("liderando, superado e últimos 10 s", () => {
    expect(bidBoxTone({ ...base, leading_is_me: true }, 30_000)).toBe("leading");
    expect(bidBoxTone({ ...base, my_best_bid_cents: 900 }, 30_000)).toBe("outbid");
    expect(bidBoxTone(base, 9_000)).toBe("ending");
    expect(bidBoxTone(base, 30_000)).toBe("neutral");
  });
});
