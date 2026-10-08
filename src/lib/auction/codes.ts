import { formatBRL } from "@/lib/money";

/** Códigos devolvidos pelas funções place_bid / buy_now / admin_* do banco. */
export type AuctionCode =
  | "leading"
  | "tie_not_leading"
  | "won"
  | "duplicate"
  | "opened"
  | "paused"
  | "resumed"
  | "extended"
  | "cancelled"
  | "closed_with_winner"
  | "closed_without_winner"
  | "not_authenticated"
  | "invalid_request"
  | "round_not_found"
  | "wrong_mode"
  | "round_not_started"
  | "round_paused"
  | "round_closed"
  | "round_not_open"
  | "round_not_paused"
  | "round_not_queued"
  | "round_not_cancellable"
  | "round_has_no_timer"
  | "another_round_active"
  | "event_not_live"
  | "already_sold"
  | "already_leading"
  | "amount_too_low"
  | "amount_too_high"
  | "invalid_amount"
  | "profile_required"
  | "blocked"
  | "must_close_lot"
  | "reason_required"
  | "forbidden"
  | "created"
  | "reordered"
  | "finished"
  | "sent"
  | "failed"
  | "closed"
  | "not_expired"
  | "queue_changed"
  | "queue_empty"
  | "event_not_found"
  | "event_already_finished"
  | "published"
  | "card_not_found"
  | "card_unavailable"
  | "event_already_published"
  | "message_not_found"
  | "message_already_done";

export interface AuctionResult {
  ok: boolean;
  code: AuctionCode;
  min_cents?: number;
  max_cents?: number;
  [key: string]: unknown;
}

/** Mensagem clara para o usuário (design system §7). */
export function auctionMessage(result: Pick<AuctionResult, "code" | "min_cents" | "max_cents">): string {
  switch (result.code) {
    case "leading":
      return "Você está liderando";
    case "tie_not_leading":
      return "Mesmo valor do líder: quem lançou primeiro continua na frente";
    case "won":
      return "Você arrematou!";
    case "duplicate":
      return "Seu lance já tinha sido registrado";
    case "not_authenticated":
      return "Entre na sua conta para participar";
    case "profile_required":
      return "Complete seu cadastro para participar";
    case "round_not_started":
      return "A rodada ainda não começou";
    case "round_paused":
      return "A rodada está pausada";
    case "round_closed":
    case "round_not_open":
      return "A rodada já foi encerrada";
    case "already_sold":
      return "Essa carta já foi arrematada";
    case "already_leading":
      return "Você já está liderando";
    case "amount_too_low":
      return result.min_cents != null
        ? `Seu lance precisa ser de pelo menos ${formatBRL(result.min_cents)}`
        : "Seu lance precisa ser maior que o atual";
    case "amount_too_high":
      return result.max_cents != null
        ? `O lance máximo agora é ${formatBRL(result.max_cents)}`
        : "Valor acima do permitido";
    case "invalid_amount":
      return "Escolha uma das opções de lance";
    case "blocked":
      return "Sua conta está bloqueada para lances. Regularize suas pendências";
    case "must_close_lot":
      return "Você já acumulou por 2 leilões. Feche seu lote para participar";
    case "forbidden":
      return "Você não tem permissão para isso";
    case "another_round_active":
      return "Encerre a rodada atual antes de abrir outra";
    case "reason_required":
      return "Informe o motivo";
    case "round_has_no_timer":
      return "Essa rodada não tem cronômetro";
    case "queue_changed":
      return "A fila mudou enquanto você editava. Confira e tente de novo";
    case "queue_empty":
      return "Não há mais cartas na fila";
    case "event_not_found":
      return "Evento não encontrado";
    case "event_already_finished":
      return "Esse evento já foi encerrado";
    case "card_not_found":
      return "Carta não encontrada";
    case "card_unavailable":
      return "Essa carta já está em outra rodada ou foi vendida";
    case "event_already_published":
      return "Esse evento já foi publicado";
    case "message_already_done":
      return "Essa mensagem já foi marcada";
    case "invalid_request":
      return "Confira os dados e tente de novo";
    default:
      return "Não foi possível concluir. Tente novamente";
  }
}
