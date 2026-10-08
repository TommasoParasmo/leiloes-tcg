import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuctionResult } from "@/lib/auction/codes";

export interface ChatMessage {
  id: string;
  nickname: string;
  body: string;
  is_admin: boolean;
  created_at: string;
}

/** O que chega pelo canal da sala: mensagem nova ou mensagem escondida pelo leiloeiro. */
export type ChatEvent = { type: "message"; message: ChatMessage } | { type: "hide"; id: string };

export const CHAT_MAX_LENGTH = 280;
/** Quantas mensagens a sala guarda na tela. */
export const CHAT_KEEP = 80;

export async function fetchChat(sb: SupabaseClient, eventId: string): Promise<ChatMessage[]> {
  const { data, error } = await sb
    .from("room_messages")
    .select("id, nickname, body, is_admin, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(CHAT_KEEP);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function sendChat(sb: SupabaseClient, eventId: string, body: string): Promise<AuctionResult & { message?: ChatMessage }> {
  const { data, error } = await sb.rpc("send_room_message", { p_event_id: eventId, p_body: body });
  if (error) throw error;
  return data as AuctionResult & { message?: ChatMessage };
}

export async function hideChat(sb: SupabaseClient, messageId: string): Promise<AuctionResult> {
  const { data, error } = await sb.rpc("admin_hide_room_message", { p_message_id: messageId });
  if (error) throw error;
  return data as AuctionResult;
}

/** Junta mensagens novas às da tela: sem repetidas, em ordem de envio, só as últimas. */
export function mergeChat(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-CHAT_KEEP);
}

export function applyChatEvent(current: ChatMessage[], e: ChatEvent): ChatMessage[] {
  return e.type === "hide" ? current.filter((m) => m.id !== e.id) : mergeChat(current, [e.message]);
}
