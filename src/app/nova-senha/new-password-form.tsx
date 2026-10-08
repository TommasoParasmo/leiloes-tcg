"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { validatePassword } from "@/lib/validation";

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validatePassword(password);
    if (invalid) return setError(invalid);
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) {
      return setError(
        error.code === "session_not_found" || error.message.toLowerCase().includes("session")
          ? "O link expirou. Peça um novo em Recuperar senha."
          : authMessage(error),
      );
    }
    router.replace("/conta");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="Pelo menos 8 caracteres, com letras e números."
      />
      <FormError message={error} />
      <Button type="submit" block pending={pending}>
        Salvar nova senha
      </Button>
    </form>
  );
}
