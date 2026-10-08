"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { validateEmail } from "@/lib/validation";

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateEmail(email);
    if (invalid) return setError(invalid);
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/nova-senha")}`,
    });
    setPending(false);
    if (error) return setError(authMessage(error));
    setSent(true);
  }

  if (sent) {
    return (
      <section className="rounded-md border border-line bg-surface p-5">
        <p className="font-bold">Verifique seu e-mail</p>
        <p className="mt-2 text-sm text-muted">Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.</p>
      </section>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-muted">Informe o e-mail da sua conta. Vamos enviar um link para criar uma nova senha.</p>
      <Field label="E-mail" name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      <FormError message={error} />
      <Button type="submit" block pending={pending}>
        Enviar link
      </Button>
    </form>
  );
}
