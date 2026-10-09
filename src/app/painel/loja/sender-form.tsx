"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { createClient } from "@/lib/supabase/client";
import { parseViaCep } from "@/lib/validation";

export type SenderValues = { name: string; street: string; number: string; complement: string; district: string; city: string; state: string };

/** Valida o remetente: tudo vazio (sem etiqueta) ou completo. Devolve os erros por campo. */
export function validateSender(v: SenderValues): Partial<Record<keyof SenderValues, string>> {
  const filled = Object.values(v).some((x) => x.trim());
  if (!filled) return {};
  const errs: Partial<Record<keyof SenderValues, string>> = {};
  if (v.name.trim().length < 2) errs.name = "Informe o nome de quem envia";
  if (v.street.trim().length < 2) errs.street = "Informe a rua";
  if (!v.number.trim()) errs.number = "Informe o número (ou S/N)";
  if (v.district.trim().length < 2) errs.district = "Informe o bairro";
  if (v.city.trim().length < 2) errs.city = "Informe a cidade";
  if (!/^[A-Za-z]{2}$/.test(v.state.trim())) errs.state = "UF com 2 letras, ex.: SP";
  return errs;
}

/** Endereço de quem envia as cartas: vai na etiqueta do SuperFrete. O CEP é o de envio, salvo acima. */
export function SenderForm({ initial, originCep }: { initial: SenderValues; originCep: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof SenderValues, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [cepNote, setCepNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [looking, setLooking] = useState(false);
  const cep = originCep.replace(/\D/g, "");

  const set = (k: keyof SenderValues, value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setSaved(false);
  };

  async function fillFromCep() {
    setLooking(true);
    setCepNote(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const addr = parseViaCep(await res.json());
      if (!addr) setCepNote("CEP não encontrado. Preencha à mão.");
      else {
        setV((s) => ({ ...s, street: addr.street || s.street, district: addr.district || s.district, city: addr.city, state: addr.state }));
        setSaved(false);
      }
    } catch {
      setCepNote("Não foi possível buscar o CEP. Preencha à mão.");
    }
    setLooking(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateSender(v);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setPending(true);
    setFormError(null);
    try {
      const { data, error } = await createClient().rpc("admin_update_sender", {
        p_name: v.name,
        p_street: v.street,
        p_number: v.number,
        p_complement: v.complement,
        p_district: v.district,
        p_city: v.city,
        p_state: v.state.toUpperCase(),
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Remetente da etiqueta</legend>
        <p className="text-sm text-muted">Vai na etiqueta do SuperFrete. Não aparece para os compradores no site.</p>
        {cep.length === 8 ? (
          <button
            type="button"
            onClick={() => void fillFromCep()}
            disabled={looking}
            aria-busy={looking || undefined}
            className="min-h-11 rounded-md bg-surface-2 text-sm font-bold disabled:text-muted"
          >
            {looking ? "Buscando o CEP…" : `Preencher pelo CEP ${cep.slice(0, 5)}-${cep.slice(5)}`}
          </button>
        ) : (
          <p className="text-sm text-muted">Salve o CEP de onde as cartas saem acima para preencher a rua sozinho.</p>
        )}
        {cepNote && <p className="text-sm text-danger">{cepNote}</p>}
        <Field label="Nome de quem envia" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={80} error={errors.name} autoComplete="name" />
        <Field label="Rua" value={v.street} onChange={(e) => set("street", e.target.value)} maxLength={120} error={errors.street} autoComplete="address-line1" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Número" value={v.number} onChange={(e) => set("number", e.target.value)} maxLength={20} error={errors.number} />
          <Field label="Complemento" value={v.complement} onChange={(e) => set("complement", e.target.value)} maxLength={60} autoComplete="address-line2" />
        </div>
        <Field label="Bairro" value={v.district} onChange={(e) => set("district", e.target.value)} maxLength={80} error={errors.district} />
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Cidade" value={v.city} onChange={(e) => set("city", e.target.value)} maxLength={80} error={errors.city} autoComplete="address-level2" />
          <Field label="UF" value={v.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} error={errors.state} autoCapitalize="characters" autoComplete="address-level1" />
        </div>
      </fieldset>
      <FormError message={formError} />
      {saved && (
        <p role="status" className="text-sm font-bold text-win">
          Remetente salvo.
        </p>
      )}
      <Button type="submit" block variant="secondary" pending={pending}>
        Salvar remetente
      </Button>
    </form>
  );
}
