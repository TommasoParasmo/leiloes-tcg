import { formatBRL } from "@/lib/money";

/** Datas e textos da tela "Criar leilão" (horário de Brasília, que não tem horário de verão desde 2019). */

const TZ = "America/Sao_Paulo";
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "2026-10-09" do dia em Brasília. */
export const brDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
}

/** Hoje, amanhã e os dois dias seguintes, para os botões de dia. */
export function dayChips(now: Date): { date: string; label: string }[] {
  return [0, 1, 2, 3].map((i) => {
    const date = brDate(new Date(now.getTime() + i * 86_400_000));
    const { d, m, weekday } = parts(date);
    const dm = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
    return { date, label: i === 0 ? `Hoje ${dm}` : i === 1 ? `Amanhã ${dm}` : `${WEEKDAYS[weekday]} ${dm}` };
  });
}

/** Título automático: "Sexta, 10/10". */
export function eventTitle(date: string): string {
  const { d, m, weekday } = parts(date);
  return `${WEEKDAYS[weekday]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Dia + hora de Brasília em ISO (UTC). */
export function startsAtIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const t = Date.parse(`${date}T${time}:00-03:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Horário já passou (ou está a menos de 1 minuto)? */
export function isPast(iso: string, now: number): boolean {
  return Date.parse(iso) <= now + 60_000;
}

/** Dia e horário que já vêm marcados: hoje às 20h; se já passou, o próximo horário de hoje; senão, amanhã às 20h. */
export function defaultSlot(now: Date, times: string[], preferred = "20:00"): { date: string; time: string } {
  const [today, tomorrow] = dayChips(now).map((c) => c.date);
  const ahead = (t: string) => !isPast(startsAtIso(today, t) ?? "", now.getTime());
  const time = [preferred, ...times.filter((t) => t > preferred)].find(ahead) ?? times.find(ahead);
  return time ? { date: today, time } : { date: tomorrow, time: preferred };
}

export interface RoundDefaults {
  startCents: number;
  incrementsCents: number[];
  seconds: number;
}

/** "Todas com lance inicial de R$ 5, botões +1, +2, +5 e 20 segundos". */
export function defaultsSummary(d: RoundDefaults): string {
  const brl = (c: number) => formatBRL(c).replace(",00", "");
  const plus = d.incrementsCents.map((c) => `+${brl(c).replace("R$ ", "").replace(/\s/g, "")}`);
  const buttons = plus.length === 1 ? `botão ${plus[0]}` : `botões ${plus.slice(0, -1).join(", ")} e ${plus.at(-1)}`;
  return `Todas com lance inicial de ${brl(d.startCents)}, ${buttons}, e ${d.seconds} segundos por carta`;
}

/** "1, 2, 5" → [100, 200, 500]; null se algo não for valor válido (até 3 botões). */
export function parseIncrements(text: string): number[] | null {
  const items = text.split(/[;/\s]+|,(?=\s)|,(?!\d)/).map((s) => s.trim()).filter(Boolean);
  if (!items.length || items.length > 3) return null;
  const cents = items.map((s) => Math.round(Number(s.replace(/^\+/, "").replace(",", ".")) * 100));
  if (cents.some((c) => !Number.isFinite(c) || c <= 0 || c > 10_000_000)) return null;
  return [...new Set(cents)].sort((a, b) => a - b);
}
