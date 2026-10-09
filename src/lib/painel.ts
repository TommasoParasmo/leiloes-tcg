/** Regras das telas simples do leiloeiro (sem acesso ao banco: dá para testar sozinhas). */

export interface HubEvent {
  id: string;
  number: number;
  status: "live" | "scheduled" | "draft";
  startsAt: string | null;
  cards: number;
}

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Qual leilão o botão principal abre: o que está ao vivo; senão o marcado para hoje;
 * senão o próximo (marcado ou rascunho). "none" quando não há nenhum.
 */
/** Leilão marcado há mais de 12 h e não aberto ficou para trás: não vira o botão principal. */
export function hubCutoff(now: Date): Date {
  return new Date(now.getTime() - 12 * 3600_000);
}

export function hubEventCta(events: HubEvent[], now: Date): { kind: "live" | "today" | "next" | "none"; event: HubEvent | null } {
  const live = events.find((e) => e.status === "live");
  if (live) return { kind: "live", event: live };
  const today = dayKey(now);
  const upcoming = events
    .filter((e) => !e.startsAt || Date.parse(e.startsAt) >= hubCutoff(now).getTime())
    .sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity));
  const todays = upcoming.find((e) => e.startsAt && dayKey(new Date(e.startsAt)) === today);
  if (todays) return { kind: "today", event: todays };
  const next = upcoming[0];
  return next ? { kind: "next", event: next } : { kind: "none", event: null };
}

export interface Debtor {
  orderId: string;
  nickname: string;
  totalCents: number;
  cards: number;
  dueAt: string | null;
  late: boolean;
  proofSent: boolean;
}

/** Só está atrasado quem ainda não mandou comprovante (mesma regra do quadro de pedidos). */
export function isLate(status: string, dueAt: string | null, now: number): boolean {
  return status === "awaiting_payment" && !!dueAt && Date.parse(dueAt) < now;
}

/** Quem me deve: atrasados primeiro, depois quem vence antes. */
export function sortDebtors(list: Debtor[]): Debtor[] {
  return [...list].sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    return (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity);
  });
}
