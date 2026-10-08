"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChipButton, ChoiceChips, MultiChips, Stepper } from "@/components/ui/chips";
import { Field, FormError } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { adminRpc, type FreeCard, type QueueRound } from "@/lib/admin-data";
import { auctionMessage } from "@/lib/auction/codes";
import { cn } from "@/lib/cn";
import { formatAmountShort, parseBRL } from "@/lib/money";

type Mode = "increments" | "options" | "speed";
type Close = "timer" | "manual";
type SpeedKind = "single" | "options";

const MODES = [
  { value: "increments", label: "Maior lance" },
  { value: "options", label: "Opções fixas" },
  { value: "speed", label: "Rapidez" },
] as const;
const CLOSES = [
  { value: "timer", label: "Pelo cronômetro" },
  { value: "manual", label: "Manual" },
] as const;
const SPEED_KINDS = [
  { value: "single", label: "Preço único" },
  { value: "options", label: "Até 4 opções" },
] as const;
const MAX_SPEED_OPTIONS = 4;
const PRESET_INCREMENTS = [100, 200, 500, 1000];
const MAX_INCREMENTS = 3;
const MAX_CENTS = 10_000_000; // R$ 100.000

const brl = (c: number) => `R$ ${formatAmountShort(c)}`;
// passo do lance inicial cresce com o valor: R$ 1 até 20, R$ 5 até 100, R$ 10 até 500, depois R$ 50
const priceStep = (v: number, dir: 1 | -1) => {
  const at = dir === 1 ? v : v - 1;
  return at < 2000 ? 100 : at < 10000 ? 500 : at < 50000 ? 1000 : 5000;
};

/**
 * Configuração de uma rodada no painel de baixo (design: "Rodada: maior lance" e
 * "Rodada: opções fixas e rapidez"). Sem `editing`, primeiro escolhe a carta.
 */
export function RoundSheet({
  sb,
  eventId,
  ordinal,
  cards,
  editing,
  initialCard,
  onSaved,
  onClose,
}: {
  sb: SupabaseClient;
  eventId: string;
  /** Número da rodada mostrado no título ("Rodada 3 · …"). */
  ordinal: number;
  cards: FreeCard[];
  editing?: QueueRound;
  /** Carta já escolhida (acabou de ser cadastrada a partir deste evento). */
  initialCard?: { id: string; name: string };
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [card, setCard] = useState<{ id: string; name: string } | null>(editing ? { id: editing.card.id, name: editing.card.name } : (initialCard ?? null));
  // rapidez com opções é guardada como maior lance com opções + preço de arremate (= maior opção)
  const speedOptions = editing?.mode === "highest_bid" && editing.fixed_price_cents != null;
  const [mode, setMode] = useState<Mode>(
    editing ? (editing.mode === "speed" || speedOptions ? "speed" : editing.bid_options_cents?.length ? "options" : "increments") : "increments",
  );
  const [speedKind, setSpeedKind] = useState<SpeedKind>(speedOptions ? "options" : "single");
  const [start, setStart] = useState(editing?.start_price_cents ?? 500);
  const [increments, setIncrements] = useState<number[]>(editing?.increments_cents ?? [100, 200, 500]);
  const [options, setOptions] = useState<number[]>(editing?.bid_options_cents ?? []);
  const [fixed, setFixed] = useState(editing?.mode === "speed" && editing.fixed_price_cents != null ? formatAmountShort(editing.fixed_price_cents) : "");
  const [close, setClose] = useState<Close>(editing?.close_mode ?? "timer");
  const [seconds, setSeconds] = useState(editing?.duration_seconds ?? 20);
  const [adding, setAdding] = useState<"increment" | "option" | null>(null);
  const [extra, setExtra] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const title = card ? `Rodada ${ordinal} · ${card.name}` : "Escolha a carta";

  function toggle(list: number[], v: number) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b);
  }

  function addExtra() {
    const cents = parseBRL(extra);
    if (!cents || cents <= 0 || cents > MAX_CENTS) return setExtraError("Valor inválido. Ex.: 3 ou 7,50");
    if (adding === "increment") setIncrements((s) => (s.includes(cents) ? s : toggle(s, cents)));
    else setOptions((s) => (s.includes(cents) ? s : toggle(s, cents)));
    setErrors({});
    setExtra("");
    setExtraError(null);
    setAdding(null);
  }

  async function save() {
    if (pending || !card) return;
    const errs: Record<string, string | undefined> = {};
    const row: Record<string, unknown> = {};
    const fixedCents = parseBRL(fixed);
    if (mode === "speed" && speedKind === "options") {
      if (options.length < 2 || options.length > MAX_SPEED_OPTIONS) errs.options = "Escolha de 2 a 4 valores";
      Object.assign(row, {
        mode: "highest_bid",
        close_mode: close,
        duration_seconds: close === "timer" ? seconds : null,
        start_price_cents: null,
        increments_cents: null,
        bid_options_cents: options,
        fixed_price_cents: options.length ? Math.max(...options) : null,
      });
    } else if (mode === "speed") {
      if (!fixedCents || fixedCents > MAX_CENTS) errs.fixed = "Informe o preço, ex.: 12";
      Object.assign(row, { mode: "speed", fixed_price_cents: fixedCents, close_mode: "manual", duration_seconds: null, start_price_cents: null, increments_cents: null, bid_options_cents: null });
    } else {
      Object.assign(row, { mode: "highest_bid", close_mode: close, duration_seconds: close === "timer" ? seconds : null, fixed_price_cents: null });
      if (mode === "increments") {
        if (!increments.length) errs.increments = "Escolha de 1 a 3 botões";
        Object.assign(row, { start_price_cents: start, increments_cents: increments, bid_options_cents: null });
      } else {
        if (options.length < 2 || options.length > 6) errs.options = "Escolha de 2 a 6 valores";
        Object.assign(row, { start_price_cents: null, increments_cents: null, bid_options_cents: options });
      }
    }
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return setFormError("Confira os campos destacados.");
    setPending(true);
    setFormError(null);
    let failure: string | null = null;
    try {
      if (editing) {
        const { error } = await sb.from("rounds").update(row).eq("id", editing.id).eq("status", "queued");
        if (error) failure = "Não foi possível salvar. A rodada pode já ter sido aberta.";
      } else {
        // pelo servidor: trava evento e carta, confere se a carta segue livre e o evento aberto
        const result = await adminRpc(sb, "admin_add_round", {
          p_event_id: eventId,
          p_card_id: card.id,
          p_mode: row.mode,
          p_start_price_cents: row.start_price_cents,
          p_increments_cents: row.increments_cents,
          p_bid_options_cents: row.bid_options_cents,
          p_fixed_price_cents: row.fixed_price_cents,
          p_close_mode: row.close_mode,
          p_duration_seconds: row.duration_seconds,
        });
        if (!result.ok) failure = auctionMessage(result);
      }
    } catch {
      failure = "Sem conexão com o servidor. Tente de novo.";
    }
    setPending(false);
    if (failure) return setFormError(failure);
    onSaved(editing ? "Rodada atualizada." : `${card.name} entrou na fila.`);
  }

  if (!card) {
    return (
      <Sheet title={title} onClose={onClose}>
        {/* cadastra e volta para cá com a carta escolhida; ela também fica em Cartas */}
        <Link
          href={`/painel/cartas/nova?evento=${eventId}`}
          // fecha o painel antes: com o <dialog> modal aberto, a página seguinte não recebe toques
          onClick={onClose}
          className="mb-2 flex min-h-12 items-center justify-center gap-1.5 rounded-sm border-2 border-dashed border-line text-sm font-bold text-accent-text"
        >
          <span aria-hidden>+</span> Cadastrar carta nova
        </Link>
        {cards.length ? (
          <ul className="flex flex-col gap-1.5">
            {cards.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setCard({ id: c.id, name: c.name })} className="flex min-h-14 w-full items-center gap-3 rounded-sm border border-line bg-surface p-2 text-left">
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt="" width={34} height={47} loading="lazy" className="h-[47px] w-[34px] rounded-[4px] object-cover" />
                  ) : (
                    <span aria-hidden className="h-[47px] w-[34px] rounded-[4px] bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{[c.variant, c.card_number].filter(Boolean).join(" · ") || "Sem variante"}</span>
                  </span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pb-2 text-sm text-muted">Todas as suas cartas já estão em eventos. Cadastre uma nova acima.</p>
        )}
      </Sheet>
    );
  }

  const extraInput = adding && (
    <div className="flex items-end gap-2">
      <Field
        className="flex-1"
        label={adding === "increment" ? "Outro botão (R$)" : "Outro valor (R$)"}
        inputMode="decimal"
        autoFocus
        value={extra}
        onChange={(e) => {
          setExtra(e.target.value);
          setExtraError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addExtra();
          }
        }}
        error={extraError}
      />
      <Button type="button" variant="secondary" className={cn("min-h-[46px]", extraError && "mb-[22px]")} onClick={addExtra}>
        Incluir
      </Button>
    </div>
  );

  const optionsMax = mode === "speed" ? MAX_SPEED_OPTIONS : 6;
  const optionsEditor = (
    <MultiChips
      label="Valores para o comprador escolher"
      options={options.map((c) => ({ value: c, label: brl(c) }))}
      selected={options}
      onToggle={(v) => setOptions((s) => s.filter((x) => x !== v))}
      error={errors.options}
      hint={
        mode === "speed"
          ? options.length >= 2
            ? `Quem tocar primeiro em ${brl(Math.max(...options))} arremata na hora. Se ninguém tocar, leva o maior lance quando a rodada encerrar.`
            : "De 2 a 4 valores. O maior arremata na hora; senão, leva o maior lance no fim."
          : "Igual às votações do WhatsApp. De 2 a 6 valores; toque num valor para tirar."
      }
      extra={
        options.length < optionsMax &&
        adding !== "option" && (
          <ChipButton
            onClick={() => {
              setAdding("option");
              setExtra("");
            }}
          >
            + valor
          </ChipButton>
        )
      }
    />
  );
  const closeControls = (
    <>
      <ChoiceChips label="Encerramento" options={CLOSES} value={close} onChange={setClose} hint={close === "manual" ? "Você encerra pelo botão “Encerrar agora”." : "Lance que assume a liderança nos últimos 5 s soma 10 s ao cronômetro."} />
      {mode !== "increments" && close === "timer" && (
        <Stepper label="Cronômetro" value={seconds} onChange={setSeconds} step={5} min={5} max={600} format={(s) => `${s} s`} parse={(s) => (/^\d+$/.test(s.trim()) ? Number(s) : null)} />
      )}
    </>
  );

  return (
    <Sheet title={title} onClose={onClose}>
      <fieldset>
        <legend className="sr-only">Modo da rodada</legend>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-surface p-1">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-sm text-center text-sm font-bold leading-tight has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                mode === m.value ? "bg-surface-2 text-text" : "text-muted",
              )}
            >
              <input
                type="radio"
                name="round-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => {
                  setMode(m.value);
                  setErrors({});
                  setAdding(null);
                }}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "speed" && (
        <ChoiceChips
          label="Tipo de rapidez"
          options={SPEED_KINDS}
          value={speedKind}
          onChange={(v) => {
            setSpeedKind(v);
            setErrors({});
            setAdding(null);
            if (v === "options") setOptions((s) => s.slice(0, MAX_SPEED_OPTIONS));
          }}
        />
      )}
      {mode === "speed" && speedKind === "options" ? (
        <>
          {optionsEditor}
          {extraInput}
          {closeControls}
        </>
      ) : mode === "speed" ? (
        <Field
          label="Preço fixo (R$)"
          inputMode="decimal"
          placeholder="12"
          value={fixed}
          onChange={(e) => {
            setFixed(e.target.value);
            setErrors({});
          }}
          error={errors.fixed}
          hint="Você libera o botão ao vivo. O primeiro toque confirmado leva."
        />
      ) : (
        <>
          {mode === "increments" ? (
            <>
              <div className={cn("grid gap-2", close === "timer" ? "grid-cols-2" : "grid-cols-1")}>
                <Stepper label="Lance inicial" value={start} onChange={setStart} step={priceStep} min={100} max={MAX_CENTS} format={brl} parse={parseBRL} inputMode="decimal" />
                {close === "timer" && <Stepper label="Cronômetro" value={seconds} onChange={setSeconds} step={5} min={5} max={600} format={(s) => `${s} s`} parse={(s) => (/^\d+$/.test(s.trim()) ? Number(s) : null)} />}
              </div>
              <MultiChips
                label="Botões de lance"
                options={[...new Set([...PRESET_INCREMENTS, ...increments])].sort((a, b) => a - b).map((c) => ({ value: c, label: `+${formatAmountShort(c)}` }))}
                selected={increments}
                onToggle={(v) => {
                  setIncrements((s) => toggle(s, v));
                  setErrors({});
                }}
                max={MAX_INCREMENTS}
                error={errors.increments}
                hint={`Até 3 botões. O comprador vê o valor final, por exemplo ${brl(start + (increments[0] ?? 100))}.`}
                extra={
                  increments.length < MAX_INCREMENTS &&
                  adding !== "increment" && (
                    <ChipButton
                      onClick={() => {
                        setAdding("increment");
                        setExtra("");
                      }}
                    >
                      + outro
                    </ChipButton>
                  )
                }
              />
            </>
          ) : (
            optionsEditor
          )}
          {extraInput}
          {closeControls}
        </>
      )}
      <FormError message={formError} />
      <Button type="button" block className="min-h-[52px]" pending={pending} onClick={() => void save()}>
        {editing ? "Salvar rodada" : "Adicionar à fila"}
      </Button>
      {!editing && (
        <button type="button" onClick={() => setCard(null)} className="min-h-11 text-sm font-bold text-muted">
          Trocar carta
        </button>
      )}
    </Sheet>
  );
}
