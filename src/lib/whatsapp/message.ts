import { formatBRL } from "@/lib/money";

/**
 * Payload gravado em whatsapp_messages.payload por app_finalize_round() (com vencedor)
 * e por app_queue_unsold_message() (sem lances: valor e vencedor nulos).
 */
export interface RoundResultPayload {
  card_name: string;
  card_variant: string | null;
  amount_cents: number | null;
  winner_nickname: string | null;
  event_number: number;
  round_id: string;
  photo_path: string | null;
}

/** Texto do resultado no formato combinado nas instruções do projeto (§6). */
export function buildRoundResultMessage(p: RoundResultPayload, siteUrl: string): string {
  const card = p.card_variant ? `${p.card_name} — ${p.card_variant}` : p.card_name;
  const link = `${siteUrl.replace(/\/$/, "")}/resultado/${p.round_id}`;
  if (p.winner_nickname == null || p.amount_cents == null) {
    return [`🃏 ${card}`, `🎯 Leilão #${p.event_number}`, "", "Sem lances nesta rodada. A carta volta em um próximo leilão!"].join("\n");
  }
  return [
    "🏆 CARTA ARREMATADA!",
    "",
    `🃏 ${card}`,
    `💰 Valor: ${formatBRL(p.amount_cents)}`,
    `👤 Vencedor: ${p.winner_nickname}`,
    `🎯 Leilão #${p.event_number}`,
    "",
    "✅ Resultado confirmado!",
    `🔗 Confira no site: ${link}`,
  ].join("\n");
}

/** Link "Abrir no WhatsApp" com o texto preenchido (modo manual). */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Convite do grupo ("https://chat.whatsapp.com/…") sem o "?mode=…" que o WhatsApp põe no fim.
 * Devolve null se não for um link de grupo. O servidor confere de novo.
 */
export function normalizeGroupUrl(value: string): string | null {
  const url = value.trim().replace(/[?#].*$/, "");
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/.test(url) ? url : null;
}
