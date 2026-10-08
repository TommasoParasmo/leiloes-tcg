"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { validateEmail } from "@/lib/validation";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateEmail(email) ?? (password ? null : "Informe sua senha");
    if (invalid) return setError(invalid);
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setPending(false);
      return setError(authMessage(error));
    }
    // continua "enviando" até a navegação terminar, para não haver segundo envio
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field label="E-mail" name="email" type="email" autoComplete="email" spellCheck={false} autoCapitalize="none" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormError message={error} />
      <Button type="submit" block pending={pending}>
        Entrar
      </Button>
      <Link href="/recuperar-senha" className="self-center py-2 text-sm font-bold text-muted">
        Esqueci minha senha
      </Link>
    </form>
  );
}
