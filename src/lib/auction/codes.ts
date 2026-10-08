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
  | "amount_already_bid"
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
  | "cpf_required"
  | "invalid_cpf"
  | "cpf_taken"
  | "cpf_already_set"
  | "saved"
  | "lot_closed"
  | "lot_not_found"
  | "lot_already_closed"
  | "address_required"
  | "quoted"
  | "proof_sent"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "removed"
  | "unblocked"
  | "order_not_found"
  | "order_wrong_status"
  | "penalty_not_found"
  | "penalty_already_removed"
  | "justification_required"
  | "user_not_found"
  | "user_not_blocked"
  | "card_not_found"
  | "card_unavailable"
  | "event_already_published"
  | "message_not_found"
  | "message_already_done"
  | "tracking_required"
  | "shipped"
  | "delivered"
  | "requeued"
  | "dismissed"
  | "rate_limited"
  | "terms_required"
  | "pending_lot"
  | "pending_orders"
  | "account_deleted";

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
    case "amount_already_bid":
      return "Você já deu esse lance. Escolha um valor maior";
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
    case "cpf_required":
      return "Informe seu CPF para dar lances";
    case "invalid_cpf":
      return "CPF inválido. Confira os números";
    case "cpf_taken":
      return "Esse CPF já tem conta. Entre com ela ou fale com o leiloeiro";
    case "cpf_already_set":
      return "Seu CPF já está cadastrado";
    case "lot_not_found":
      return "Lote não encontrado";
    case "lot_already_closed":
      return "Esse lote já foi fechado";
    case "address_required":
      return "Cadastre um endereço de entrega antes de fechar o lote";
    case "order_not_found":
      return "Pedido não encontrado";
    case "tracking_required":
      return "Informe o código de rastreio";
    case "order_wrong_status":
      return "O pedido mudou enquanto você olhava. Recarregue a página";
    case "penalty_not_found":
      return "Advertência não encontrada";
    case "penalty_already_removed":
      return "Essa advertência já foi retirada";
    case "justification_required":
      return "Escreva a justificativa (mínimo 5 letras)";
    case "user_not_found":
      return "Comprador não encontrado";
    case "user_not_blocked":
      return "Esse comprador não está bloqueado";
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
    case "rate_limited":
      return "Muitas tentativas seguidas. Espere alguns segundos";
    case "terms_required":
      return "Aceite os termos de uso e a política de privacidade para continuar";
    case "pending_lot":
      return "Você tem cartas guardadas no lote. Feche o lote e conclua o pedido antes de excluir a conta";
    case "pending_orders":
      return "Você tem um pedido em andamento. Conclua ou cancele antes de excluir a conta";
    default:
      return "Não foi possível concluir. Tente novamente";
  }
}
