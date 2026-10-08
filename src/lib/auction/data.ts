import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuctionResult } from "./codes";
import type { CardInfo, EventInfo, RoundState } from "./types";

export const CARD_PHOTOS_BUCKET = "card-photos";

/** Leituras e chamadas da sala. Funcionam com o cliente do servidor e do navegador. */

export async function fetchRoundState(sb: SupabaseClient, roundId: string): Promise<RoundState | null> {
  const { data, error } = await sb.rpc("round_public_state", { p_round_id: roundId });
  if (error) throw error;
  return (data as RoundState | null) ?? null;
}

interface CardRow {
  id: string;
  name: string;
  tcg: string;
  collection: string | null;
  card_number: string | null;
  language: string | null;
  variant: string | null;
  condition: string | null;
  notes: string | null;
  liga_price_cents: number | null;
  card_photos: { storage_path: string; position: number }[];
}

export async function fetchCard(sb: SupabaseClient, cardId: string): Promise<CardInfo | null> {
  const { data, error } = await sb
    .from("cards")
    .select("id, name, tcg, collection, card_number, language, variant, condition, notes, liga_price_cents, card_photos(storage_path, position)")
    .eq("id", cardId)
    .maybeSingle<CardRow>();
  if (error) throw error;
  if (!data) return null;
  const photos = [...data.card_photos]
    .sort((a, b) => a.position - b.position)
    .map((p) => sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(p.storage_path).data.publicUrl);
  return { ...data, liga_price_cents: data.liga_price_cents == null ? null : Number(data.liga_price_cents), photos };
}

export async function fetchEvent(sb: SupabaseClient, eventId: string): Promise<EventInfo | null> {
  const { data, error } = await sb
    .from("events")
    .select("id, number, title, status, rounds(count)")
    .eq("id", eventId)
    .maybeSingle<{ id: string; number: number; title: string; status: EventInfo["status"]; rounds: { count: number }[] }>();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, number: data.number, title: data.title, status: data.status, total_rounds: data.rounds[0]?.count ?? 0 };
}

/**
 * Rodada que a sala deve mostrar: a aberta/pausada; senão a última encerrada
 * (para o resultado continuar na tela); senão a próxima da fila.
 */
export async function pickRoomRoundId(sb: SupabaseClient, eventId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("rounds")
    .select("id, position, status, closed_at")
    .eq("event_id", eventId)
    .order("position");
  if (error) throw error;
  const rounds = (data ?? []) as { id: string; position: number; status: string; closed_at: string | null }[];
  const active = rounds.find((r) => r.status === "open" || r.status === "paused");
  if (active) return active.id;
  const finished = rounds.filter((r) => r.closed_at).sort((a, b) => Date.parse(b.closed_at!) - Date.parse(a.closed_at!));
  if (finished[0]) return finished[0].id;
  return rounds.find((r) => r.status === "queued")?.id ?? null;
}

export async function placeBid(sb: SupabaseClient, roundId: string, amountCents: number, key: string): Promise<AuctionResult> {
  const { data, error } = await sb.rpc("place_bid", { p_round_id: roundId, p_amount_cents: amountCents, p_idempotency_key: key });
  if (error) throw error;
  return data as AuctionResult;
}

export async function buyNow(sb: SupabaseClient, roundId: string, key: string): Promise<AuctionResult> {
  const { data, error } = await sb.rpc("buy_now", { p_round_id: roundId, p_idempotency_key: key });
  if (error) throw error;
  return data as AuctionResult;
}

/** Repete a chamada uma vez em falha de rede, com a MESMA chave (o servidor não duplica). */
export async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TypeError || (err as { message?: string })?.message?.includes("fetch")) {
      await new Promise((r) => setTimeout(r, 400));
      return fn();
    }
    throw err;
  }
}
