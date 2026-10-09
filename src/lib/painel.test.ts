import { describe, expect, it } from "vitest";
import { hubCutoff, isLate, hubEventCta, sortDebtors, type Debtor, type HubEvent } from "./painel";

const ev = (id: string, status: HubEvent["status"], startsAt: string | null): HubEvent => ({ id, number: 1, status, startsAt, cards: 3 });
// 9/10/2026 15h em Brasília
const now = new Date("2026-10-09T18:00:00Z");

describe("início do leiloeiro", () => {
  it("ao vivo vem primeiro; depois o de hoje; depois o próximo; nada = criar", () => {
    expect(hubEventCta([ev("a", "scheduled", "2026-10-09T23:00:00Z"), ev("b", "live", null)], now)).toMatchObject({ kind: "live", event: { id: "b" } });
    // 20h de hoje em Brasília é 23h UTC; 01h UTC do dia 10 ainda é dia 9 em Brasília
    expect(hubEventCta([ev("a", "scheduled", "2026-10-11T23:00:00Z"), ev("b", "scheduled", "2026-10-10T01:00:00Z")], now)).toMatchObject({ kind: "today", event: { id: "b" } });
    expect(hubEventCta([ev("a", "scheduled", "2026-10-12T23:00:00Z"), ev("b", "draft", "2026-10-10T23:00:00Z")], now)).toMatchObject({ kind: "next", event: { id: "b" } });
    expect(hubEventCta([ev("a", "draft", null)], now)).toMatchObject({ kind: "next", event: { id: "a" } });
    // leilão de anteontem que ninguém começou não aparece como próximo
    expect(hubEventCta([ev("a", "scheduled", "2026-10-07T23:00:00Z")], now)).toEqual({ kind: "none", event: null });
  });

  it("quem me deve: atrasados primeiro, depois quem vence antes", () => {
    const d = (orderId: string, dueAt: string | null, late = false): Debtor => ({ orderId, nickname: orderId, totalCents: 100, cards: 1, dueAt, late, proofSent: false });
    const sorted = sortDebtors([d("c", null), d("b", "2026-10-20T00:00:00Z"), d("a", "2026-10-01T00:00:00Z", true), d("d", "2026-10-12T00:00:00Z")]);
    expect(sorted.map((x) => x.orderId)).toEqual(["a", "d", "b", "c"]);
  });
});

describe("isLate", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it("só quem ainda não mandou comprovante fica atrasado", () => {
    expect(isLate("awaiting_payment", "2026-10-09T11:00:00Z", now)).toBe(true);
    expect(isLate("proof_sent", "2026-10-09T11:00:00Z", now)).toBe(false);
    expect(isLate("awaiting_payment", "2026-10-09T13:00:00Z", now)).toBe(false);
    expect(isLate("awaiting_payment", null, now)).toBe(false);
  });
});

describe("hubCutoff", () => {
  it("é 12 h antes de agora", () => {
    expect(hubCutoff(new Date("2026-10-09T12:00:00Z")).toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });
});
