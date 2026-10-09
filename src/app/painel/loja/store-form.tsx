"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { createClient } from "@/lib/supabase/client";

type Values = { pixKey: string; pixName: string; pixCity: string; originCep: string };

const maskCep = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** Pix (aparece para o comprador pagar) e CEP de onde as cartas saem (para o SuperFrete). */
export function StoreForm({ storeName, initial }: { storeName: string; initial: Values }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (k: keyof Values, value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setSaved(false);
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    const cep = v.originCep.replace(/\D/g, "");
    if (cep && cep.length !== 8) errs.originCep = "CEP com 8 números, ex.: 01310-100";
    if (v.pixKey.trim() && !v.pixName.trim()) errs.pixName = "Informe o nome de quem recebe";
    if (v.pixKey.trim() && !v.pixCity.trim()) errs.pixCity = "Informe a cidade";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setPending(true);
    setFormError(null);
    try {
      const { data, error } = await createClient().rpc("admin_update_store", {
        p_pix_key: v.pixKey,
        p_pix_name: v.pixName,
        p_pix_city: v.pixCity,
        p_origin_cep: cep,
      });
      const r = data as AuctionResult | null;
      if (error || !r?.ok) setFormError(r ? auctionMessage(r) : "Não foi possível salvar. Tente de novo.");
      else {
        setSaved(true);
        router.refresh();
      }
    } catch {
      setFormError("Sem conexão com o servidor. Tente de novo.");
    }
    setPending(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-10 pt-2">
      {storeName && <p className="text-sm text-muted">{storeName}</p>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Pix para receber</legend>
          <Field label="Chave Pix" value={v.pixKey} onChange={(e) => set("pixKey", e.target.value)} maxLength={77} autoComplete="off" hint="CPF, CNPJ, e-mail, telefone ou chave aleatória. Aparece para o comprador pagar." />
          <Field label="Nome de quem recebe" value={v.pixName} onChange={(e) => set("pixName", e.target.value)} maxLength={60} error={errors.pixName} />
          <Field label="Cidade" value={v.pixCity} onChange={(e) => set("pixCity", e.target.value)} maxLength={40} error={errors.pixCity} />
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Envio</legend>
          <Field
            label="CEP de onde as cartas saem"
            inputMode="numeric"
            placeholder="01310-100"
            value={v.originCep}
            onChange={(e) => set("originCep", maskCep(e.target.value))}
            error={errors.originCep}
            hint="Usado para calcular o frete no SuperFrete. Não aparece para os compradores."
          />
        </fieldset>
        <FormError message={formError} />
        {saved && (
          <p role="status" className="text-sm font-bold text-win">
            Dados da loja salvos.
          </p>
        )}
        <Button type="submit" block pending={pending}>
          Salvar
        </Button>
      </form>
    </main>
  );
}
