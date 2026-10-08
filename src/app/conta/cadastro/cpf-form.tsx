"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";
import { formatCpf, onlyDigits, validateCpf } from "@/lib/validation";

/** CPF é pedido antes do primeiro lance: identifica o comprador e impede contas repetidas. */
export function CpfForm({ next }: { next?: string }) {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateCpf(cpf);
    if (err) return setError(err);
    setPending(true);
    setFormError(null);
    const { data, error: rpcError } = await createClient().rpc("complete_profile", { p_cpf: onlyDigits(cpf) });
    const result = data as AuctionResult | null;
    if (rpcError || !result?.ok) {
      setPending(false);
      if (result?.code === "invalid_cpf" || result?.code === "cpf_taken") return setError(auctionMessage(result));
      return setFormError(result ? auctionMessage(result) : "Sem conexão. Tente de novo.");
    }
    router.replace(safeNext(next, "/conta"));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field
        label="CPF"
        name="cpf"
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        value={cpf}
        onChange={(e) => {
          setCpf(formatCpf(e.target.value));
          setError(null);
        }}
        error={error}
        hint="Usado só para identificar você no pedido e no envio. Uma conta por CPF."
      />
      <FormError message={formError} />
      <Button type="submit" block className="min-h-[52px]" pending={pending}>
        Salvar e voltar
      </Button>
    </form>
  );
}
