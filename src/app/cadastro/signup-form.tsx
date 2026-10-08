"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { TERMS_VERSION } from "@/lib/legal";
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

export function SignupForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "found" | "not_found">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

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
    const termsErr = accepted ? null : "Para criar a conta, aceite os termos e a política de privacidade.";
    setTermsError(termsErr);
    if (Object.values(errs).some(Boolean) || termsErr) {
      setFormError("Confira os campos destacados.");
      focusFirstInvalid(e.currentTarget as HTMLFormElement);
      return;
    }
    setPending(true);
    setFormError(null);
    const sb = createClient();

    const form = e.currentTarget as HTMLFormElement;
    const [{ data: nickFree, error: nickErr }, { data: phoneFree, error: phoneErr }] = await Promise.all([
      sb.rpc("nickname_available", { p_nickname: values.nickname.trim() }),
      sb.rpc("whatsapp_available", { p_whatsapp: v.onlyDigits(values.whatsapp) }),
    ]);
    if (nickErr?.code === "rate_limited" || phoneErr?.code === "rate_limited") {
      setPending(false);
      return setFormError("Muitas tentativas seguidas. Espere um minuto e tente de novo.");
    }
    if (nickFree === false || phoneFree === false) {
      setPending(false);
      setErrors((s) => ({
        ...s,
        nickname: nickFree === false ? "Esse apelido já está em uso. Escolha outro." : s.nickname,
        // uma conta por WhatsApp: evita contas duplicadas de quem foi bloqueado
        whatsapp: phoneFree === false ? "Esse WhatsApp já tem conta. Entre com ela ou recupere a senha." : s.whatsapp,
      }));
      setFormError("Confira os campos destacados.");
      focusFirstInvalid(form);
      return;
    }

    const { data, error } = await sb.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: {
        emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=${encodeURIComponent(`/entrar?confirmado=1&next=${encodeURIComponent(next)}`)}`,
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
          terms_version: TERMS_VERSION,
        },
      },
    });
    if (error) {
      setPending(false);
      return setFormError(authMessage(error));
    }
    if (data.session) {
      // continua "enviando" até a navegação terminar, para não haver segundo envio
      router.replace(next);
      router.refresh();
      return;
    }
    setPending(false);
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
      <Field label="Nome completo" name="name" autoComplete="name" value={values.fullName} onChange={set("fullName")} error={errors.fullName} />
      <Field label="Apelido público" name="nickname" autoComplete="nickname" spellCheck={false} autoCapitalize="none" value={values.nickname} onChange={set("nickname")} error={errors.nickname} hint="Aparece nos lances e no grupo do WhatsApp." maxLength={30} />
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="WhatsApp"
          name="tel"
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
          name="postal-code"
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
      {/* sempre montado: leitores de tela anunciam a busca e o preenchimento automático */}
      <p aria-live="polite" className="sr-only">
        {cepStatus === "loading"
          ? "Buscando endereço pelo CEP…"
          : cepStatus === "found"
            ? "Endereço encontrado. Rua, bairro, cidade e UF foram preenchidos."
            : cepStatus === "not_found"
              ? "CEP não encontrado. Preencha o endereço."
              : ""}
      </p>
      <Field label="Rua" name="address-line1" autoComplete="address-line1" value={values.street} onChange={set("street")} error={errors.street} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Número" name="address-number" value={values.number} onChange={set("number")} error={errors.number} />
        <Field label="Complemento" name="address-line2" autoComplete="address-line2" placeholder="Apto, bloco…" value={values.complement} onChange={set("complement")} />
      </div>
      <Field label="Bairro" name="district" value={values.district} onChange={set("district")} error={errors.district} />
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Field label="Cidade" name="city" autoComplete="address-level2" value={values.city} onChange={set("city")} error={errors.city} />
        <Field label="UF" name="state" autoComplete="address-level1" autoCapitalize="characters" maxLength={2} value={values.state} onChange={set("state")} error={errors.state} />
      </div>
      <Field label="E-mail" name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" value={values.email} onChange={set("email")} error={errors.email} />
      <Field
        label="Senha"
        name="new-password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={set("password")}
        error={errors.password}
        hint="Pelo menos 8 caracteres, com letras e números."
      />
      <div>
        <label className="flex min-h-12 items-start gap-3 py-1 text-sm">
          <input
            type="checkbox"
            name="terms"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked);
              setTermsError(null);
            }}
            aria-invalid={termsError ? true : undefined}
            aria-describedby={termsError ? "terms-error" : undefined}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" target="_blank" className="font-bold text-accent-text underline">
              termos de uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" target="_blank" className="font-bold text-accent-text underline">
              política de privacidade
            </Link>
            .
          </span>
        </label>
        {termsError && (
          <p id="terms-error" className="text-xs font-semibold text-danger">
            {termsError}
          </p>
        )}
      </div>
      <FormError message={formError} />
      <Button type="submit" block pending={pending}>
        Criar conta
      </Button>
      <p className="text-center text-xs text-muted">Seus dados são usados só para lances, pagamentos e frete (LGPD).</p>
    </form>
  );
}

/** Leva o foco ao primeiro campo com erro, depois que o React marcar aria-invalid. */
function focusFirstInvalid(form: HTMLFormElement) {
  requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
}
