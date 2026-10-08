"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import type { FreeCard } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { parseBRL, parseBRLList } from "@/lib/money";

type Mode = "increments" | "options" | "speed";

/** Escolhe uma carta livre e configura a rodada (modo, valores, cronômetro). */
export function AddRoundForm({
  sb,
  sellerId,
  eventId,
  nextPosition,
  cards,
  onAdded,
}: {
  sb: SupabaseClient;
  sellerId: string;
  eventId: string;
  nextPosition: number;
  cards: FreeCard[];
  onAdded: () => void;
}) {
  const [cardId, setCardId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("increments");
  const [start, setStart] = useState("");
  const [increments, setIncrements] = useState("1 2 5");
  const [options, setOptions] = useState("");
  const [fixed, setFixed] = useState("");
  const [timer, setTimer] = useState(true);
  const [seconds, setSeconds] = useState("60");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string | undefined> = {};
    const row: Record<string, unknown> = { seller_id: sellerId, event_id: eventId, position: nextPosition, card_id: cardId };
    if (!cardId) errs.card = "Escolha uma carta";
    if (mode === "speed") {
      const price = parseBRL(fixed);
      if (!price) errs.fixed = "Informe o preço, ex.: 12";
      Object.assign(row, { mode: "speed", fixed_price_cents: price, close_mode: "manual" });
    } else {
      const secs = Number(seconds);
      if (timer && !(Number.isInteger(secs) && secs >= 5 && secs <= 3600)) errs.seconds = "Entre 5 e 3600 segundos";
      Object.assign(row, { mode: "highest_bid", close_mode: timer ? "timer" : "manual", duration_seconds: timer ? secs : null });
      if (mode === "increments") {
        const startCents = parseBRL(start);
        const inc = parseBRLList(increments);
        if (!startCents) errs.start = "Informe o lance inicial, ex.: 6";
        if (!inc || inc.length > 3) errs.increments = "Até 3 valores, ex.: 1 2 5";
        Object.assign(row, { start_price_cents: startCents, increments_cents: inc });
      } else {
        const opts = parseBRLList(options);
        if (!opts || opts.length < 2 || opts.length > 6) errs.options = "De 2 a 6 valores, ex.: 6 7 8 9 10";
        Object.assign(row, { bid_options_cents: opts });
      }
    }
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return setFormError("Confira os campos destacados.");
    setPending(true);
    setFormError(null);
    const { error } = await sb.from("rounds").insert(row);
    setPending(false);
    if (error) return setFormError("Não foi possível adicionar. Confira os valores e tente de novo.");
    setCardId(null);
    onAdded();
  }

  if (!cards.length) {
    return <p className="text-sm text-muted">Todas as suas cartas já estão em eventos. Cadastre novas em Cartas.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-semibold text-muted">Carta</legend>
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto overscroll-contain" role="radiogroup">
          {cards.map((c) => (
            <label
              key={c.id}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-sm border p-2",
                cardId === c.id ? "border-accent bg-accent/10" : "border-line bg-surface",
              )}
            >
              <input type="radio" name="card" value={c.id} checked={cardId === c.id} onChange={() => setCardId(c.id)} className="sr-only" />
              {c.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photo} alt="" width={36} height={48} loading="lazy" className="h-12 w-9 rounded-[4px] object-cover" />
              ) : (
                <span aria-hidden className="h-12 w-9 rounded-[4px] bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{c.name}</span>
                <span className="block truncate text-xs text-muted">{[c.variant, c.card_number].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.card && <p className="text-xs font-semibold text-danger">{errors.card}</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-muted">Modo</legend>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-surface p-1">
          {(
            [
              ["increments", "Lance +"],
              ["options", "Opções"],
              ["speed", "Rapidez"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-sm text-sm font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                mode === value ? "bg-surface-2 text-text" : "text-muted",
              )}
            >
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "speed" ? (
        <Field label="Preço fixo (R$)" inputMode="decimal" placeholder="12" value={fixed} onChange={(e) => setFixed(e.target.value)} error={errors.fixed} hint="Quem tocar primeiro em ARREMATAR leva." />
      ) : (
        <>
          {mode === "increments" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lance inicial (R$)" inputMode="decimal" placeholder="6" value={start} onChange={(e) => setStart(e.target.value)} error={errors.start} />
              <Field label="Incrementos (R$)" placeholder="1 2 5" value={increments} onChange={(e) => setIncrements(e.target.value)} error={errors.increments} />
            </div>
          ) : (
            <Field label="Opções de lance (R$)" placeholder="6 7 8 9 10" value={options} onChange={(e) => setOptions(e.target.value)} error={errors.options} hint="Separe com espaço. Ex.: 6 7 8 9 10" />
          )}
          <div className="grid grid-cols-[1fr_120px] items-end gap-2">
            <label className="flex min-h-[46px] cursor-pointer items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={timer} onChange={(e) => setTimer(e.target.checked)} className="size-5 accent-[var(--color-accent)]" />
              Encerrar por cronômetro
            </label>
            {timer && <Field label="Segundos" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} error={errors.seconds} />}
          </div>
          {!timer && <p className="-mt-1 text-xs text-muted">Sem cronômetro, você encerra a rodada pelo botão “Encerrar agora”.</p>}
        </>
      )}
      <FormError message={formError} />
      <Button type="submit" block pending={pending}>
        Adicionar à fila
      </Button>
    </form>
  );
}
