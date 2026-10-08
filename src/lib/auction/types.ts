/** Espelha o jsonb devolvido por public.round_public_state(). */
export type RoundStatus = "queued" | "open" | "paused" | "closed" | "cancelled";
export type AuctionMode = "highest_bid" | "speed";

export interface RecentBid {
  seq: number;
  nickname: string;
  amount_cents: number;
  created_at: string;
  is_me: boolean;
}

export interface RoundState {
  id: string;
  event_id: string;
  card_id: string;
  position: number;
  mode: AuctionMode;
  status: RoundStatus;
  start_price_cents: number | null;
  increments_cents: number[] | null;
  bid_options_cents: number[] | null;
  fixed_price_cents: number | null;
  close_mode: "manual" | "timer";
  duration_seconds: number | null;
  opened_at: string | null;
  ends_at: string | null;
  paused_remaining_ms: number | null;
  closed_at: string | null;
  current_amount_cents: number | null;
  leading_nickname: string | null;
  leading_is_me: boolean;
  my_best_bid_cents: number | null;
  my_block: "not_authenticated" | "profile_required" | "blocked" | "must_close_lot" | null;
  bid_count: number;
  server_now: string;
  recent_bids: RecentBid[];
}

export interface CardInfo {
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
  photos: string[]; // URLs públicas, a primeira é a principal
}

export interface EventInfo {
  id: string;
  number: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "finished" | "cancelled";
  total_rounds: number;
}
