/** Traduz erros do Supabase Auth para mensagens claras. */
export function authMessage(error: { message?: string; code?: string } | null | undefined): string {
  const m = (error?.message ?? "").toLowerCase();
  const code = error?.code ?? "";
  if (code === "invalid_credentials" || m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if (code === "email_not_confirmed" || m.includes("not confirmed")) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (code === "user_already_exists" || m.includes("already registered")) return "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.";
  if (code === "weak_password" || m.includes("password")) return "Senha fraca. Use pelo menos 8 caracteres com letras e números.";
  if (code === "over_email_send_rate_limit" || m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (m.includes("database error saving new user")) return "Não foi possível salvar o cadastro. Confira os dados (apelido pode já estar em uso).";
  return "Não foi possível concluir. Tente novamente.";
}
