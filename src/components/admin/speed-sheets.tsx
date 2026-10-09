"use client";
import Link from "next/link";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { adminRpc, type FreeCard, type QueueRound } from "@/lib/admin-data";
import { auctionMessage } from "@/lib/auction/codes";
import { optionsLabel, SPEED_STEPS_CENTS, speedOptions } from "@/lib/auction/logic";
import { cn } from "@/lib/cn";
import { formatAmountShort, MAX_PRICE_CENTS, parseBRL } from "@/lib/money";

/**
 * Só rapidez por enquanto: pôr uma carta na fila é escolher a carta e confirmar o mínimo da
 * Liga (vem do cadastro) e o degrau. Viram 4 botões; o maior arremata na hora.
 */
export function AddCardSheet({
  sb,
  eventId,
  cards,
  initialCard,
  onSaved,
  onClose,
}: {
  sb: SupabaseClient;
  eventId: string;
  cards: FreeCard[];
  /** Carta já escolhida (acabou de ser cadastrada a partir deste evento). */
  initialCard?: { id: string; name: string };
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [card, setCard] = useState<FreeCard | null>(() => (initialCard ? (cards.find((c) => c.id === initialCard.id) ?? null) : null));

  if (!card) {
    return (
      <Sheet title="Qual carta?" onClose={onClose}>
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
                <button type="button" onClick={() => setCard(c)} className="flex min-h-14 w-full items-center gap-3 rounded-sm border border-line bg-surface p-2 text-left">
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt="" width={34} height={47} loading="lazy" className="h-[47px] w-[34px] rounded-[4px] object-cover" />
                  ) : (
                    <span aria-hidden className="h-[47px] w-[34px] rounded-[4px] bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{c.price_cents != null ? `Liga R$ ${formatAmountShort(c.price_cents)}` : "Sem mínimo da Liga"}</span>
                  </span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pb-2 text-sm text-muted">Todas as suas cartas já estão em leilões. Cadastre uma nova acima.</p>
        )}
      </Sheet>
    );
  }

  return (
    <PriceForm
      title={card.name}
      initialCents={card.price_cents}
      initialStep={SPEED_STEPS_CENTS[0]}
      submitLabel="Pôr na fila"
      onClose={onClose}
      onSubmit={async (options) => {
        // pelo servidor: trava evento e carta, confere se a carta segue livre e o evento aberto
        const result = await adminRpc(sb, "admin_add_round", {
          p_event_id: eventId,
          p_card_id: card.id,
          p_mode: "highest_bid",
          p_start_price_cents: null,
          p_increments_cents: null,
          p_bid_options_cents: options,
          p_fixed_price_cents: Math.max(...options),
          p_close_mode: "manual",
          p_duration_seconds: null,
        });
        if (!result.ok) return auctionMessage(result);
        onSaved(`${card.name} entrou na fila.`);
        return null;
      }}
    />
  );
}

/** “Mudar preço” de uma carta que ainda está na fila: novo início e degrau dos 4 botões. */
export function RoundPriceSheet({ sb, round, onSaved, onClose }: { sb: SupabaseClient; round: QueueRound; onSaved: (message: string) => void; onClose: () => void }) {
  const opts = round.bid_options_cents;
  const step = opts && opts.length > 1 ? opts[1] - opts[0] : SPEED_STEPS_CENTS[0];
  return (
    <PriceForm
      title={round.card.name}
      initialCents={opts?.[0] ?? round.fixed_price_cents ?? round.start_price_cents}
      initialStep={(SPEED_STEPS_CENTS as readonly number[]).includes(step) ? step : SPEED_STEPS_CENTS[0]}
      submitLabel="Salvar"
      onClose={onClose}
      onSubmit={async (options) => {
        const { data, error } = await sb
          .from("rounds")
          .update({
            mode: "highest_bid",
            bid_options_cents: options,
            fixed_price_cents: Math.max(...options),
            close_mode: "manual",
            duration_seconds: null,
            start_price_cents: null,
            increments_cents: null,
          })
          .eq("id", round.id)
          .eq("status", "queued")
          .select("id");
        if (error || !data?.length) return "Não foi possível salvar. A carta pode já ter sido liberada.";
        onSaved(`${round.card.name}: ${optionsLabel(options)}.`);
        return null;
      }}
    />
  );
}


function PriceForm({
  title,
  initialCents,
  initialStep,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialCents: number | null;
  initialStep: number;
  submitLabel: string;
  /** Recebe os 4 botões; devolve a mensagem de erro, ou null quando deu certo. */
  onSubmit: (options: number[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialCents != null ? formatAmountShort(initialCents) : "");
  const [step, setStep] = useState(initialStep);
  const typed = parseBRL(value);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    if (pending) return;
    const cents = parseBRL(value);
    if (!cents || cents <= 0) return setFieldError("Informe o valor, ex.: 10 ou 12,50");
    if (cents > MAX_PRICE_CENTS) return setFieldError("O preço máximo é R$ 100.000");
    setPending(true);
    setError(null);
    let failure: string | null;
    try {
      failure = await onSubmit(speedOptions(cents, step));
    } catch {
      failure = "Sem conexão com o servidor. Tente de novo.";
    }
    setPending(false);
    if (failure) setError(failure);
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <Field
        label="Mínimo da Liga (R$)"
        inputMode="decimal"
        placeholder="Ex.: 10"
        autoFocus
        value={value}
        onChange={(e) => (setValue(e.target.value), setFieldError(undefined))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        error={fieldError}
      />
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Degrau dos botões">
        {SPEED_STEPS_CENTS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={step === s}
            onClick={() => setStep(s)}
            className={cn("min-h-11 rounded-pill border px-3 text-sm font-bold", step === s ? "border-accent bg-accent/15 text-text" : "border-line text-muted")}
          >
            +R$ {s / 100}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        {typed && typed > 0 ? `Botões: ${optionsLabel(speedOptions(typed, step))}. O maior leva na hora.` : "Os 4 botões começam neste valor. O maior leva na hora."}
      </p>
      <FormError message={error} />
      <Button block className="min-h-[52px]" pending={pending} onClick={() => void save()}>
        {submitLabel}
      </Button>
    </Sheet>
  );
}
