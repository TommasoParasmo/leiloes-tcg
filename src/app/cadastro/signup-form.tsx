"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import * as v from "@/lib/validation";

type Values = {
  fullName: string;
  nickname: string;
  whatsapp: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  email: string;
  password: string;
};
type Errors = Partial<Record<keyof Values, string | null>>;

const empty: Values = {
  fullName: "",
  nickname: "",
  whatsapp: "",
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  email: "",
  password: "",
};

function validate(x: Values): Errors {
  return {
    fullName: v.validateFullName(x.fullName),
    nickname: v.validateNickname(x.nickname),
    whatsapp: v.validateWhatsapp(x.whatsapp),
    cep: v.validateCep(x.cep),
    street: v.validateRequired(x.street, "a rua"),
    number: v.validateRequired(x.number, "o número"),
    district: v.validateRequired(x.district, "o bairro"),
    city: v.validateRequired(x.city, "a cidade"),
    state: /^[A-Za-z]{2}$/.test(x.state.trim()) ? null : "Use a sigla do estado, ex.: SP",
    email: v.validateEmail(x.email),
    password: v.validatePassword(x.password),
  };
}

export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "found" | "not_found">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((s) => ({ ...s, [k]: e.target.value }));
    setErrors((s) => ({ ...s, [k]: null }));
  };

  async function lookupCep(raw: string) {
    const cep = v.onlyDigits(raw);
    if (cep.length !== 8) return;
    setCepStatus("loading");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const addr = v.parseViaCep(await res.json());
      if (!addr) return setCepStatus("not_found");
      setValues((s) => ({ ...s, street: addr.street || s.street, district: addr.district || s.district, city: addr.city, state: addr.state }));
      setCepStatus("found");
    } catch {
      setCepStatus("not_found");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(values);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return setFormError("Confira os campos destacados.");
    setPending(true);
    setFormError(null);
    const sb = createClient();

    const { data: available } = await sb.rpc("nickname_available", { p_nickname: values.nickname.trim() });
    if (available === false) {
      setPending(false);
      setErrors((s) => ({ ...s, nickname: "Esse apelido já está em uso. Escolha outro." }));
      return setFormError("Confira os campos destacados.");
    }

    const { data, error } = await sb.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: {
        emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=${encodeURIComponent("/entrar?confirmado=1")}`,
        data: {
          full_name: values.fullName.trim(),
          nickname: values.nickname.trim(),
          whatsapp: v.onlyDigits(values.whatsapp),
          address: {
            cep: v.onlyDigits(values.cep),
            street: values.street.trim(),
            number: values.number.trim(),
            complement: values.complement.trim(),
            district: values.district.trim(),
            city: values.city.trim(),
            state: values.state.trim().toUpperCase(),
          },
        },
      },
    });
    setPending(false);
    if (error) return setFormError(authMessage(error));
    if (data.session) {
      router.replace("/");
      router.refresh();
      return;
    }
    setSentTo(values.email.trim());
  }

  if (sentTo) {
    return (
      <section className="rounded-md border border-line bg-surface p-5">
        <p className="font-display text-lg font-bold">Confirme seu e-mail</p>
        <p className="mt-2 text-sm text-muted">
          Enviamos um link para <b className="text-text">{sentTo}</b>. Abra o e-mail e toque no link para ativar a conta.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field label="Nome completo" autoComplete="name" value={values.fullName} onChange={set("fullName")} error={errors.fullName} />
      <Field label="Apelido público" value={values.nickname} onChange={set("nickname")} error={errors.nickname} hint="Aparece nos lances e no grupo do WhatsApp." maxLength={30} />
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="WhatsApp"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={values.whatsapp}
          onChange={(e) => {
            setValues((s) => ({ ...s, whatsapp: v.formatWhatsapp(e.target.value) }));
            setErrors((s) => ({ ...s, whatsapp: null }));
          }}
          error={errors.whatsapp}
        />
        <Field
          label="CEP"
          inputMode="numeric"
          autoComplete="postal-code"
          value={values.cep}
          onChange={(e) => {
            const cep = v.formatCep(e.target.value);
            setValues((s) => ({ ...s, cep }));
            setErrors((s) => ({ ...s, cep: null }));
            setCepStatus("idle");
            void lookupCep(cep);
          }}
          error={errors.cep ?? (cepStatus === "not_found" ? "CEP não encontrado. Preencha o endereço abaixo." : null)}
          success={cepStatus === "found" ? "Endereço encontrado pelo CEP" : null}
          hint={cepStatus === "loading" ? "Buscando endereço…" : undefined}
        />
      </div>
      <Field label="Rua" autoComplete="address-line1" value={values.street} onChange={set("street")} error={errors.street} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Número" value={values.number} onChange={set("number")} error={errors.number} />
        <Field label="Complemento" placeholder="Apto, bloco" value={values.complement} onChange={set("complement")} />
      </div>
      <Field label="Bairro" value={values.district} onChange={set("district")} error={errors.district} />
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Field label="Cidade" autoComplete="address-level2" value={values.city} onChange={set("city")} error={errors.city} />
        <Field label="UF" autoComplete="address-level1" maxLength={2} value={values.state} onChange={set("state")} error={errors.state} />
      </div>
      <Field label="E-mail" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={set("email")} error={errors.email} />
      <Field
        label="Senha"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={set("password")}
        error={errors.password}
        hint="Pelo menos 8 caracteres, com letras e números."
      />
      <FormError message={formError} />
      <Button type="submit" block pending={pending}>
        Criar conta
      </Button>
      <p className="text-center text-xs text-muted">Seus dados são usados só para lances, pagamentos e frete (LGPD).</p>
    </form>
  );
}
