import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import type { PillTone } from "@/components/ui/pill";

/** Pedido (lote fechado) com cartas, frete e pagamento atual. Leitura via RLS. */

export type OrderStatus = "awaiting_shipping_quote" | "awaiting_payment" | "proof_sent" | "paid" | "shipped" | "delivered" | "cancelled";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: PillTone }> = {
  awaiting_shipping_quote: { label: "Calculando frete", tone: "neutral" },
  awaiting_payment: { label: "Aguardando Pix", tone: "warn" },
  proof_sent: { label: "Comprovante enviado", tone: "acc" },
  paid: { label: "Pago", tone: "win" },
  shipped: { label: "Enviado", tone: "win" },
  delivered: { label: "Entregue", tone: "win" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const PROOFS_BUCKET = "payment-proofs";

export interface OrderItem {
  id: string;
  amount_cents: number;
  card_name: string;
  card_variant: string | null;
  event_number: number;
  photo_url: string | null;
}

export interface Order {
  id: string;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number | null;
  total_cents: number;
  due_at: string | null;
  notes: string | null;
  created_at: string;
  user_id: string;
  shipping_address: { street: string; number: string; complement: string | null; district: string; city: string; state: string; cep: string } | null;
  shipment: { service_name: string | null; delivery_days: number | null; tracking_code: string | null } | null;
  payment: { id: string; status: string; proof_path: string | null; amount_cents: number } | null;
  buyer?: { nickname: string; full_name: string; whatsapp: string } | null;
  items: OrderItem[];
}

const ORDER_SELECT =
  "id, status, subtotal_cents, shipping_cents, total_cents, due_at, notes, created_at, user_id, lot_id, shipping_address, shipments(service_name, delivery_days, tracking_code), payments(id, status, proof_path, amount_cents, created_at)";

type Row = Omit<Order, "shipment" | "payment" | "items" | "buyer"> & {
  lot_id: string;
  shipments: Order["shipment"] | Order["shipment"][];
  payments: (NonNullable<Order["payment"]> & { created_at: string })[];
};

function shape(row: Row): Omit<Order, "items"> & { lot_id: string } {
  const { shipments, payments, ...rest } = row;
  const shipment = Array.isArray(shipments) ? (shipments[0] ?? null) : shipments;
  // pagamento atual: o mais recente que não foi recusado nem cancelado
  const current = [...(payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((p) => p.status !== "rejected" && p.status !== "cancelled");
  return {
    ...rest,
    subtotal_cents: Number(rest.subtotal_cents),
    shipping_cents: rest.shipping_cents == null ? null : Number(rest.shipping_cents),
    total_cents: Number(rest.total_cents),
    shipment,
    payment: current ? { id: current.id, status: current.status, proof_path: current.proof_path, amount_cents: Number(current.amount_cents) } : null,
  };
}

async function itemsFor(sb: SupabaseClient, lotIds: string[]): Promise<Map<string, OrderItem[]>> {
  const map = new Map<string, OrderItem[]>();
  if (!lotIds.length) return map;
  const { data, error } = await sb
    .from("wins")
    .select("id, lot_id, amount_cents, status, events(number), cards(name, variant, card_photos(storage_path, position))")
    .in("lot_id", lotIds)
    .neq("status", "cancelled")
    .order("won_at");
  if (error) throw error;
  type W = { id: string; lot_id: string; amount_cents: number; events: { number: number }; cards: { name: string; variant: string | null; card_photos: { storage_path: string; position: number }[] } };
  for (const w of (data ?? []) as unknown as W[]) {
    const photo = [...w.cards.card_photos].sort((a, b) => a.position - b.position)[0];
    const item: OrderItem = {
      id: w.id,
      amount_cents: Number(w.amount_cents),
      card_name: w.cards.name,
      card_variant: w.cards.variant,
      event_number: w.events.number,
      photo_url: photo ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl : null,
    };
    map.set(w.lot_id, [...(map.get(w.lot_id) ?? []), item]);
  }
  return map;
}

export async function fetchOrder(sb: SupabaseClient, id: string): Promise<Order | null> {
  const { data, error } = await sb.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const order = shape(data as unknown as Row);
  const items = await itemsFor(sb, [order.lot_id]);
  return { ...order, items: items.get(order.lot_id) ?? [] };
}

export async function fetchOrders(sb: SupabaseClient, filter: { userId?: string; sellerId?: string; statuses?: OrderStatus[] }): Promise<Order[]> {
  let q = sb.from("orders").select(`${ORDER_SELECT}, profiles(nickname, full_name, whatsapp)`).order("created_at", { ascending: false }).limit(200);
  if (filter.userId) q = q.eq("user_id", filter.userId);
  if (filter.sellerId) q = q.eq("seller_id", filter.sellerId);
  if (filter.statuses) q = q.in("status", filter.statuses);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as unknown as (Row & { profiles: Order["buyer"] })[]).map((r) => ({ ...shape(r), buyer: r.profiles }));
  const items = await itemsFor(sb, rows.map((r) => r.lot_id));
  return rows.map((r) => ({ ...r, items: items.get(r.lot_id) ?? [] }));
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
/** "12/10, 20:00" no horário de Brasília. */
export const formatDue = (iso: string) => dateFmt.format(new Date(iso));
