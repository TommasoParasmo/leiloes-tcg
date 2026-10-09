"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import type { FreeCard } from "@/lib/admin-data";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { cn } from "@/lib/cn";
import { parseBRL } from "@/lib/money";
import { dayChips, defaultSlot, defaultsSummary, eventTitle, isPast, parseIncrements, startsAtIso, type RoundDefaults } from "@/lib/quick-event";
import { createClient } from "@/lib/supabase/client";

const TIMES = ["19:00", "20:00", "21:00"];
const SECONDS = [10, 20, 30, 60];

/**
 * Criar leilão em um passo: dia, horário e tocar nas cartas. Todas entram com o lance
 * padrão da loja e o leilão já sai publicado; dá para mudar carta por carta depois.
 */
export function EventForm({ cards, defaults: initialDefaults, now }: { cards: FreeCard[]; defaults: RoundDefaults; now: number }) {
  const router = useRouter();
  const days = useMemo(() => dayChips(new Date(now)), [now]);
  const [initialSlot] = useState(() => defaultSlot(new Date(now), TIMES));
  const [date, setDate] = useState(initialSlot.date);
  const [otherDay, setOtherDay] = useState(false);
  const [time, setTime] = useState(initialSlot.time);
  const [otherTime, setOtherTime] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => cards.map((c) => c.id));
  const [defaults, setDefaults] = useState(initialDefaults);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const all = picked.length === cards.length;
  const toggle = (id: string) => (setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])), setError(null));

  async function create() {
    const iso = startsAtIso(date, time);
    if (!iso) return setError("Escolha o dia e o horário.");
    if (isPast(iso, new Date().getTime())) return setError("Esse horário já passou. Escolha outro.");
    if (!picked.length) return setError("Toque em pelo menos uma carta.");
    setPending(true);
    setError(null);
    // ordem do leilão = ordem da grade (as mais novas primeiro)
    const ids = cards.map((c) => c.id).filter((id) => picked.includes(id));
    try {
      const { data, error: rpcError } = await createClient().rpc("admin_create_quick_event", { p_title: eventTitle(date), p_starts_at: iso, p_card_ids: ids });
      const r = data as (AuctionResult & { id?: string; card_id?: string }) | null;
      if (rpcError || !r?.ok || !r.id) {
        setPending(false);
        if (r?.code === "card_unavailable" && r.card_id) {
          // a carta entrou em outro leilão enquanto esta tela estava aberta: tira da seleção
          const name = cards.find((c) => c.id === r.card_id)?.name ?? "Uma carta";
          setPicked((s) => s.filter((x) => x !== r.card_id));
          return setError(`${name} já está em outro leilão e saiu da lista. Toque em criar de novo.`);
        }
        return setError(r ? auctionMessage(r) : "Não foi possível criar o leilão. Tente de novo.");
      }
      router.replace(`/painel/eventos/${r.id}`);
    } catch {
      setPending(false);
      setError("Sem conexão com o servidor. Tente de novo.");
    }
  }

  if (!cards.length) {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5 text-center">
        <p className="font-bold">Nenhuma carta livre para leiloar</p>
        <p className="text-sm text-muted">Cadastre as cartas primeiro. Depois é só voltar aqui e tocar nelas.</p>
        <Link href="/painel/cartas/nova" className="flex min-h-12 items-center justify-center rounded-md bg-accent font-bold text-on-accent">
          Cadastrar cartas
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold text-muted">Quando?</legend>
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <Chip key={d.date} on={!otherDay && date === d.date} onClick={() => (setDate(d.date), setOtherDay(false))}>
              {d.label}
            </Chip>
          ))}
          <Chip on={otherDay} onClick={() => setOtherDay(true)}>
            Outro dia
          </Chip>
        </div>
        {otherDay && <Field label="Dia" type="date" value={date} min={days[0].date} onChange={(e) => setDate(e.target.value)} />}
        <div className="flex flex-wrap gap-1.5">
          {TIMES.map((t) => (
            <Chip key={t} on={!otherTime && time === t} onClick={() => (setTime(t), setOtherTime(false))}>
              {t.replace(":00", "h")}
            </Chip>
          ))}
          <Chip on={otherTime} onClick={() => setOtherTime(true)}>
            Outro horário
          </Chip>
        </div>
        {otherTime && <Field label="Horário" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-bold text-muted">Quais cartas? Toque para escolher</legend>
          <button type="button" onClick={() => setPicked(all ? [] : cards.map((c) => c.id))} className="min-h-10 px-1 text-sm font-extrabold text-accent-text">
            {all ? "Nenhuma" : "Todas"}
          </button>
        </div>
        <ul className="grid grid-cols-4 gap-1.5">
          {cards.map((c) => {
            const on = picked.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={c.name}
                  onClick={() => toggle(c.id)}
                  className={cn("relative block aspect-[63/88] w-full overflow-hidden rounded-[7px] bg-surface", on ? "ring-[2.5px] ring-accent" : "opacity-45")}
                >
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="grid size-full place-items-center p-1 text-center text-[10px] font-bold leading-tight">{c.name}</span>
                  )}
                  {on && (
                    <span aria-hidden className="absolute right-1 top-1 grid size-[18px] place-items-center rounded-full bg-accent text-[11px] font-black text-white">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex items-center justify-between gap-2.5 rounded-sm border border-line bg-surface px-3 py-2.5 text-[13px]">
        <span>{defaultsSummary(defaults)}</span>
        <button type="button" onClick={() => setEditing(true)} className="min-h-10 shrink-0 px-1 font-extrabold text-accent-text">
          Mudar
        </button>
      </div>

      <FormError message={error} />
      <Button block className="min-h-[72px] font-display text-xl" pending={pending} disabled={!picked.length} onClick={() => void create()}>
        {picked.length ? `Criar leilão com ${picked.length} ${picked.length === 1 ? "carta" : "cartas"}` : "Toque nas cartas"}
      </Button>
      <p className="-mt-2 text-center text-xs text-muted">O leilão já aparece para todos. Dá para mudar a ordem e o lance de cada carta depois.</p>

      {editing && <DefaultsSheet value={defaults} onClose={() => setEditing(false)} onSaved={(d) => (setDefaults(d), setEditing(false))} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("min-h-10 rounded-pill border px-3.5 text-sm font-bold", on ? "border-accent bg-accent/15 text-text" : "border-line text-muted")}
    >
      {children}
    </button>
  );
}

/** Lance padrão da loja: vale para todos os próximos leilões. */
function DefaultsSheet({ value, onClose, onSaved }: { value: RoundDefaults; onClose: () => void; onSaved: (d: RoundDefaults) => void }) {
  const [start, setStart] = useState((value.startCents / 100).toFixed(2).replace(".", ",").replace(",00", ""));
  const [steps, setSteps] = useState(value.incrementsCents.map((c) => (c / 100).toFixed(2).replace(".", ",").replace(",00", "")).join(" "));
  const [seconds, setSeconds] = useState(value.seconds);
  const [errors, setErrors] = useState<{ start?: string; steps?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const startCents = parseBRL(start);
    const incrementsCents = parseIncrements(steps);
    const errs = {
      start: startCents && startCents > 0 ? undefined : "Informe o lance inicial, ex.: 5",
      steps: incrementsCents ? undefined : "Até 3 valores separados por espaço, ex.: 1 2 5",
    };
    setErrors(errs);
    if (!startCents || !incrementsCents) return;
    setPending(true);
    setError(null);
    try {
      const { data, error: rpcError } = await createClient().rpc("admin_update_round_defaults", {
        p_start_price_cents: startCents,
        p_increments_cents: incrementsCents,
        p_duration_seconds: seconds,
      });
      const r = data as AuctionResult | null;
      if (rpcError || !r?.ok) setError(r ? auctionMessage(r) : "Não foi possível salvar. Tente de novo.");
      else return onSaved({ startCents, incrementsCents, seconds });
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    }
    setPending(false);
  }

  return (
    <Sheet title="Lance padrão" onClose={onClose}>
      <p className="text-sm text-muted">Vale para as cartas dos próximos leilões. Uma carta só pode ser mudada na tela do leilão.</p>
      <Field label="Lance inicial (R$)" inputMode="decimal" value={start} onChange={(e) => (setStart(e.target.value), setErrors((s) => ({ ...s, start: undefined })))} error={errors.start} />
      <Field
        label="Botões de lance (R$)"
        value={steps}
        onChange={(e) => (setSteps(e.target.value), setErrors((s) => ({ ...s, steps: undefined })))}
        error={errors.steps}
        hint="Quanto cada botão soma. Ex.: 1 2 5 vira +1, +2 e +5."
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-muted">Tempo de cada carta</span>
        <div className="flex flex-wrap gap-1.5">
          {SECONDS.map((s) => (
            <Chip key={s} on={seconds === s} onClick={() => setSeconds(s)}>
              {s} segundos
            </Chip>
          ))}
        </div>
      </div>
      <FormError message={error} />
      <Button block className="min-h-[52px]" pending={pending} onClick={() => void save()}>
        Salvar lance padrão
      </Button>
    </Sheet>
  );
}
