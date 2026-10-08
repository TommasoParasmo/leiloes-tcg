import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_PHOTOS_BUCKET } from "./auction/data";
import type { AuctionResult } from "./auction/codes";
import type { AuctionMode, RoundStatus } from "./auction/types";

/** Leituras e ações do painel do leiloeiro (cliente do navegador). */

export interface QueueRound {
  id: string;
  position: number;
  status: RoundStatus;
  mode: AuctionMode;
  start_price_cents: number | null;
  increments_cents: number[] | null;
  bid_options_cents: number[] | null;
  fixed_price_cents: number | null;
  close_mode: "manual" | "timer";
  duration_seconds: number | null;
  current_amount_cents: number | null;
  card: { id: string; name: string; variant: string | null; photo: string | null };
}

export interface FreeCard {
  id: string;
  name: string;
  variant: string | null;
  card_number: string | null;
  photo: string | null;
}

type PhotoRow = { storage_path: string; position: number }[];

function firstPhoto(sb: SupabaseClient, photos: PhotoRow): string | null {
  const p = [...photos].sort((a, b) => a.position - b.position)[0];
  return p ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(p.storage_path).data.publicUrl : null;
}

export async function fetchEventRounds(sb: SupabaseClient, eventId: string): Promise<QueueRound[]> {
  const { data, error } = await sb
    .from("rounds")
    .select(
      "id, position, status, mode, start_price_cents, increments_cents, bid_options_cents, fixed_price_cents, close_mode, duration_seconds, current_amount_cents, cards(id, name, variant, card_photos(storage_path, position))",
    )
    .eq("event_id", eventId)
    .order("position");
  if (error) throw error;
  type Row = Omit<QueueRound, "card"> & { cards: { id: string; name: string; variant: string | null; card_photos: PhotoRow } };
  return ((data ?? []) as unknown as Row[]).map(({ cards, ...r }) => ({
    ...r,
    card: { id: cards.id, name: cards.name, variant: cards.variant, photo: firstPhoto(sb, cards.card_photos) },
  }));
}

/**
 * Cartas do leiloeiro fora de qualquer rodada viva e sem venda. Carta que encerrou sem
 * lances ou foi cancelada volta para cá. O servidor confere de novo ao adicionar.
 */
export async function fetchFreeCards(sb: SupabaseClient, sellerId: string): Promise<FreeCard[]> {
  const { data, error } = await sb
    .from("cards")
    .select("id, name, variant, card_number, card_photos(storage_path, position), rounds(status), wins(status)")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  type Row = Omit<FreeCard, "photo"> & { card_photos: PhotoRow; rounds: { status: RoundStatus }[]; wins: { status: string }[] };
  const live: RoundStatus[] = ["queued", "open", "paused"];
  return ((data ?? []) as unknown as Row[])
    .filter((c) => !c.rounds.some((r) => live.includes(r.status)) && !c.wins.some((w) => w.status !== "cancelled"))
    .map((c) => ({ id: c.id, name: c.name, variant: c.variant, card_number: c.card_number, photo: firstPhoto(sb, c.card_photos) }));
}

export async function adminRpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<AuctionResult> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data as AuctionResult;
}

/** "Maior lance · R$ 5 · +1/+2/+5 · 20 s" — resumo da configuração da rodada. */
export function roundSummary(r: Pick<QueueRound, "mode" | "increments_cents" | "bid_options_cents" | "fixed_price_cents" | "close_mode" | "duration_seconds" | "start_price_cents">): string {
  const brl = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace(".", ","));
  if (r.mode === "speed") return `Rapidez · R$ ${brl(r.fixed_price_cents ?? 0)}`;
  const close = r.close_mode === "timer" ? `${r.duration_seconds} s` : "manual";
  if (r.bid_options_cents?.length && r.fixed_price_cents != null)
    return `Rapidez · R$ ${r.bid_options_cents.map(brl).join("/")} · arremata em R$ ${brl(r.fixed_price_cents)} · ${close}`;
  if (r.bid_options_cents?.length) return `Opções R$ ${r.bid_options_cents.map(brl).join("/")} · ${close}`;
  return `Maior lance · R$ ${brl(r.start_price_cents ?? 0)} · +${(r.increments_cents ?? []).map(brl).join("/+")} · ${close}`;
}
