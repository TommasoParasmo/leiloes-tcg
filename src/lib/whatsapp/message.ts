import { formatBRL } from "@/lib/money";

/** Payload gravado em whatsapp_messages.payload por app_finalize_round(). */
export interface RoundResultPayload {
  card_name: string;
  card_variant: string | null;
  amount_cents: number;
  winner_nickname: string;
  event_number: number;
  round_id: string;
  photo_path: string | null;
}

/** Texto do resultado no formato combinado nas instruções do projeto (§6). */
export function buildRoundResultMessage(p: RoundResultPayload, siteUrl: string): string {
  const card = p.card_variant ? `${p.card_name} — ${p.card_variant}` : p.card_name;
  const link = `${siteUrl.replace(/\/$/, "")}/resultado/${p.round_id}`;
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
