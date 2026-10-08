import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";

export interface LotWin {
  id: string;
  amount_cents: number;
  won_at: string;
  status: string;
  card_name: string;
  card_variant: string | null;
  event_number: number;
  photo_url: string | null;
}

export interface Lot {
  id: string;
  status: "open" | "closed" | "cancelled";
  seller_name: string;
  first_event_number: number;
  events_used: number;
  max_events: number;
  must_close: boolean;
  total_cents: number;
  wins: LotWin[];
}

export async function myLots(sb: SupabaseClient): Promise<Lot[]> {
  const { data, error } = await sb.rpc("my_lots");
  if (error) throw error;
  type Raw = Omit<Lot, "wins"> & { wins: (Omit<LotWin, "photo_url"> & { photo_path: string | null })[] };
  return ((data ?? []) as Raw[]).map((l) => ({
    ...l,
    wins: l.wins.map(({ photo_path, ...w }) => ({
      ...w,
      photo_url: photo_path ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(photo_path).data.publicUrl : null,
    })),
  }));
}
