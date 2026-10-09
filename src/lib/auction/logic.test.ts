import { describe, expect, it } from "vitest";
import { bidBoxTone, bidChoices, breakRemainingMs, clockOffsetMs, formatCountdown, mergePublicState, nextClockSync, nextEventStatus, optionsLabel, remainingMs, speedOptions, timerProgress } from "./logic";
import type { RoundState } from "./types";

const base: RoundState = {
  id: "r",
  rev: 3,
  event_status: "live",
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
  my_nickname: null,
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

  it("rapidez com opções: quem lidera ainda pode tocar no valor que arremata na hora", () => {
    const s = { ...base, bid_options_cents: [1000, 1100, 1200, 1300], fixed_price_cents: 1300, current_amount_cents: 1100, leading_is_me: true };
    expect(bidChoices(s).map((c) => [c.amount_cents, c.disabled])).toEqual([
      [1000, true],
      [1100, true],
      [1200, true],
      [1300, false],
    ]);
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

describe("nextClockSync", () => {
  const server = "2026-10-08T20:40:30.000Z";
  const t = Date.parse(server);
  it("desconta metade da ida e volta", () => {
    expect(nextClockSync(null, server, t - 1000, t - 800)).toEqual({ offsetMs: 900, rttMs: 200 });
  });
  it("ignora medição bem mais lenta que a melhor e mantém o relógio", () => {
    const good = { offsetMs: 900, rttMs: 100 };
    const slow = nextClockSync(good, server, t - 2000, t);
    expect(slow.offsetMs).toBe(900);
    expect(slow.rttMs).toBeCloseTo(110);
    expect(nextClockSync(good, server, t - 100, t + 10).rttMs).toBe(110);
  });
});

describe("mergePublicState", () => {
  const mine = { ...base, my_nickname: "Lia", my_best_bid_cents: 600, current_amount_cents: 600, leading_nickname: "Lia", leading_is_me: true };
  it("reconhece a liderança e o histórico pelo apelido", () => {
    const pub: RoundState = {
      ...base,
      rev: 4,
      my_block: "not_authenticated",
      current_amount_cents: 700,
      leading_nickname: "Rui",
      recent_bids: [
        { seq: 2, nickname: "Rui", amount_cents: 700, created_at: "", is_me: false },
        { seq: 1, nickname: "Lia", amount_cents: 600, created_at: "", is_me: false },
      ],
    };
    const merged = mergePublicState(mine, pub);
    expect(merged).toMatchObject({ rev: 4, my_block: null, leading_is_me: false, my_best_bid_cents: 600, my_nickname: "Lia" });
    expect(merged.recent_bids.map((b) => b.is_me)).toEqual([false, true]);
  });
  it("visitante nunca lidera", () => {
    const pub = { ...base, leading_nickname: "Lia", current_amount_cents: 600 };
    expect(mergePublicState({ ...base, my_block: "not_authenticated" }, pub).leading_is_me).toBe(false);
  });
  it("líder que trocou de apelido continua líder enquanto o lance não muda", () => {
    // a leitura pessoal já traz o apelido novo; o público ainda mostra o antigo
    const renamed = { ...mine, my_nickname: "Lia2" };
    const pub: RoundState = { ...base, rev: 9, current_amount_cents: 600, leading_nickname: "Lia", recent_bids: [] };
    expect(mergePublicState(renamed, pub).leading_is_me).toBe(true);
    expect(mergePublicState(renamed, { ...pub, current_amount_cents: 700, leading_nickname: "Rafa" }).leading_is_me).toBe(false);
  });
});

describe("nextEventStatus", () => {
  it("não volta de encerrado para ao vivo", () => {
    expect(nextEventStatus("finished", "live")).toBe("finished");
    expect(nextEventStatus("live", "finished")).toBe("finished");
    expect(nextEventStatus(null, "live")).toBe("live");
    expect(nextEventStatus("scheduled", "live")).toBe("live");
  });
});

describe("breakRemainingMs", () => {
  it("conta o intervalo pelo relógio do servidor", () => {
    const now = Date.parse("2026-10-09T20:00:00Z");
    // aparelho 2 s atrasado em relação ao servidor
    expect(breakRemainingMs("2026-10-09T20:05:00Z", now, 2000)).toBe(298_000);
    expect(breakRemainingMs("2026-10-09T19:59:00Z", now, 0)).toBe(0);
    expect(breakRemainingMs(null, now, 0)).toBeNull();
  });
});

describe("speedOptions", () => {
  it("monta os 4 botões a partir do mínimo da Liga", () => {
    expect(speedOptions(1000, 100)).toEqual([1000, 1100, 1200, 1300]);
    expect(speedOptions(1000, 200)).toEqual([1000, 1200, 1400, 1600]);
    expect(speedOptions(1250, 100)).toEqual([1250, 1350, 1450, 1550]);
  });
  it("vira uma linha legível", () => {
    expect(optionsLabel([1000, 1200, 1400, 1600])).toBe("R$ 10 · 12 · 14 · 16");
    expect(optionsLabel([1250, 1350, 1450, 1550])).toBe("R$ 12,50 · 13,50 · 14,50 · 15,50");
  });
});
