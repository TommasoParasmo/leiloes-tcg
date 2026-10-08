// Validações do cadastro. O banco repete as regras críticas (checks e gatilho);
// aqui é para mostrar o erro no campo antes de enviar.

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function validateWhatsapp(input: string): string | null {
  const d = onlyDigits(input);
  if (d.length < 10 || d.length > 13) return "Informe o WhatsApp com DDD, por exemplo (11) 98765-4321";
  return null;
}

export function formatWhatsapp(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function validateCep(input: string): string | null {
  return onlyDigits(input).length === 8 ? null : "O CEP tem 8 números";
}

export function formatCep(input: string): string {
  const d = onlyDigits(input).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function validateNickname(input: string): string | null {
  const t = input.trim();
  if (t.length < 2 || t.length > 30) return "O apelido precisa ter de 2 a 30 caracteres";
  return null;
}

export function validateFullName(input: string): string | null {
  const t = input.trim();
  if (t.length < 2) return "Informe seu nome completo";
  if (t.length > 120) return "Nome muito longo";
  return null;
}

export function validateEmail(input: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim()) ? null : "Informe um e-mail válido";
}

export function validatePassword(input: string): string | null {
  if (input.length < 8) return "A senha precisa ter pelo menos 8 caracteres";
  if (!/[A-Za-z]/.test(input) || !/\d/.test(input)) return "Use letras e números na senha";
  return null;
}

export function validateRequired(input: string, label: string): string | null {
  return input.trim() ? null : `Informe ${label}`;
}

/** Endereço vindo do ViaCEP. */
export interface CepAddress {
  street: string;
  district: string;
  city: string;
  state: string;
}

export function parseViaCep(json: unknown): CepAddress | null {
  const j = json as { erro?: unknown; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
  if (!j || j.erro || !j.localidade || !j.uf) return null;
  return { street: j.logradouro ?? "", district: j.bairro ?? "", city: j.localidade, state: j.uf };
}

/** CPF com dígitos verificadores (mesma regra de app_valid_cpf no banco). */
export function validateCpf(input: string): string | null {
  const d = onlyDigits(input);
  if (d.length !== 11) return "O CPF tem 11 números";
  if (/^(\d)\1{10}$/.test(d)) return "CPF inválido";
  const n = d.split("").map(Number);
  for (const len of [9, 10]) {
    const sum = n.slice(0, len).reduce((acc, x, i) => acc + x * (len + 1 - i), 0);
    if (((sum * 10) % 11) % 10 !== n[len]) return "CPF inválido. Confira os números";
  }
  return null;
}

export function formatCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
