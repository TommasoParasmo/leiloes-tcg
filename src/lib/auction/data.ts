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
    .select("id, number, title, status, rounds(id)")
    .eq("id", eventId)
    .maybeSingle<{ id: string; number: number; title: string; status: EventInfo["status"]; rounds: { id: string }[] }>();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, number: data.number, title: data.title, status: data.status, total_rounds: data.rounds.length };
}

/** Uma leitura para a sala: rodada da vez (estado pessoal) e status do evento. */
export async function fetchRoomState(sb: SupabaseClient, eventId: string): Promise<{ event_status: EventInfo["status"]; state: RoundState | null } | null> {
  const { data, error } = await sb.rpc("room_state", { p_event_id: eventId });
  if (error) throw error;
  return (data as { event_status: EventInfo["status"]; state: RoundState | null } | null) ?? null;
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
