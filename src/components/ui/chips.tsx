"use client";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";

const chip =
  "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3.5 text-sm font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40";
const chipOn = "border-accent bg-accent/15 text-text";
const chipOff = "border-line bg-surface text-muted";

type Option<T extends string> = T | { value: T; label: string };
const valueOf = <T extends string>(o: Option<T>) => (typeof o === "string" ? o : o.value);
const labelOf = <T extends string>(o: Option<T>) => (typeof o === "string" ? o : o.label);

/** Escolha única em pílulas (design: .chips). Rádio de verdade por baixo, para teclado e leitor de tela. */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
  hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const v = valueOf(o);
          return (
            <label key={v} className={cn(chip, value === v ? chipOn : chipOff)}>
              <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
              {labelOf(o)}
            </label>
          );
        })}
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

/** Várias escolhas em pílulas; `max` trava as não marcadas quando o limite é atingido. */
export function MultiChips({
  label,
  options,
  selected,
  onToggle,
  max,
  hint,
  error,
  extra,
}: {
  label: string;
  options: { value: number; label: string }[];
  selected: number[];
  onToggle: (v: number) => void;
  max?: number;
  hint?: string;
  error?: string;
  /** Pílula extra no fim (ex.: "+ outro"), para abrir um campo livre. */
  extra?: React.ReactNode;
}) {
  const full = max != null && selected.length >= max;
  const hintId = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={hintId}>
      <legend className="mb-1.5 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label key={o.value} className={cn(chip, on ? chipOn : chipOff)}>
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onToggle(o.value)} className="sr-only" />
              {o.label}
            </label>
          );
        })}
        {extra}
      </div>
      <p id={hintId} className={cn("text-xs", error ? "font-semibold text-danger" : "text-muted")}>
        {error ?? hint}
      </p>
    </fieldset>
  );
}

/** Pílula com cara de chip que é um botão (ex.: "+ outro"). */
export function ChipButton({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={cn(chip, chipOff, "border-dashed", className)} />;
}

/**
 * − valor + com botões de 44px (design: .step). O valor do meio também aceita digitar,
 * para não precisar de dezenas de toques em valores altos.
 */
export function Stepper({
  label,
  value,
  onChange,
  step,
  min,
  max,
  format,
  parse,
  inputMode = "numeric",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Passo do −/+; pode depender do valor atual. */
  step: number | ((v: number, dir: 1 | -1) => number);
  min: number;
  max: number;
  format: (v: number) => string;
  parse: (s: string) => number | null;
  inputMode?: "numeric" | "decimal";
}) {
  const id = useId();
  const [typing, setTyping] = useState<string | null>(null);
  const stepFor = (dir: 1 | -1) => (typeof step === "number" ? step : step(value, dir));
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = "grid size-11 shrink-0 place-items-center rounded-sm bg-surface-2 text-xl font-bold disabled:opacity-40";
  function commit() {
    if (typing == null) return;
    const v = parse(typing);
    if (v != null) onChange(clamp(v));
    setTyping(null);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-line bg-surface p-1">
        <button type="button" className={btn} aria-label={`Diminuir ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(clamp(value - stepFor(-1)))}>
          −
        </button>
        <input
          id={id}
          inputMode={inputMode}
          value={typing ?? format(value)}
          onFocus={(e) => {
            setTyping(format(value).replace(/[^\d,]/g, ""));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="w-0 min-w-0 flex-1 bg-transparent text-center font-display text-md font-bold tabular"
        />
        <button type="button" className={btn} aria-label={`Aumentar ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(clamp(value + stepFor(1)))}>
          +
        </button>
      </div>
    </div>
  );
}
