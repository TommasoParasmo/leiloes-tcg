import type { SupabaseClient } from "@supabase/supabase-js";

export interface EventListItem {
  id: string;
  number: number;
  title: string;
  status: "scheduled" | "live" | "finished" | "cancelled";
  starts_at: string | null;
  share_slug: string;
  round_count: number;
}

/** Eventos publicados (RLS esconde os rascunhos de quem não é leiloeiro). */
export async function listEvents(sb: SupabaseClient): Promise<EventListItem[]> {
  const { data, error } = await sb
    .from("events")
    .select("id, number, title, status, starts_at, share_slug, rounds(id)")
    .neq("status", "draft")
    .order("number", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((e) => ({
    ...(e as unknown as Omit<EventListItem, "round_count">),
    round_count: (e as unknown as { rounds: { id: string }[] }).rounds.length,
  }));
}

export function eventDay(iso: string | null): { day: string; month: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const tz = "America/Sao_Paulo";
  return {
    day: d.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: tz }),
    month: d.toLocaleDateString("pt-BR", { month: "short", timeZone: tz }).replace(".", "").toUpperCase(),
    time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).replace(":00", "h"),
  };
}
