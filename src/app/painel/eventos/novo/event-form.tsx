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
import { formatBRL, MAX_PRICE_CENTS, parseBRL } from "@/lib/money";
import { dayChips, defaultSlot, eventTitle, isPast, startsAtIso } from "@/lib/quick-event";
import { createClient } from "@/lib/supabase/client";

const TIMES = ["19:00", "20:00", "21:00"];

/**
 * Criar leilão em um passo: dia, horário e tocar nas cartas. Só rapidez por enquanto:
 * cada carta entra pelo preço do cadastro e o leilão já sai publicado. Carta antiga sem
 * preço pede o preço ao ser tocada.
 */
export function EventForm({ cards: initialCards, now }: { cards: FreeCard[]; now: number }) {
  const router = useRouter();
  const days = useMemo(() => dayChips(new Date(now)), [now]);
  const [initialSlot] = useState(() => defaultSlot(new Date(now), TIMES));
  const [date, setDate] = useState(initialSlot.date);
  const [otherDay, setOtherDay] = useState(false);
  const [time, setTime] = useState(initialSlot.time);
  const [otherTime, setOtherTime] = useState(false);
  const [cards, setCards] = useState(initialCards);
  const [picked, setPicked] = useState<string[]>(() => initialCards.filter((c) => c.price_cents != null).map((c) => c.id));
  // carta sem preço tocada: abre o "Quanto custa?"
  const [pricing, setPricing] = useState<FreeCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pickable = cards.filter((c) => c.price_cents != null);
  const all = pickable.length > 0 && picked.length === pickable.length;
  const toggle = (c: FreeCard) => {
    setError(null);
    if (c.price_cents == null) return setPricing(c);
    setPicked((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]));
  };

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
        if (r?.code === "price_required" && r.card_id) {
          const card = cards.find((c) => c.id === r.card_id);
          setPicked((s) => s.filter((x) => x !== r.card_id));
          if (card) setPricing({ ...card, price_cents: null });
          return setError(`${card?.name ?? "Uma carta"} está sem preço.`);
        }
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
          <button type="button" onClick={() => setPicked(all ? [] : pickable.map((c) => c.id))} className="min-h-10 px-1 text-sm font-extrabold text-accent-text">
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
                  onClick={() => toggle(c)}
                  className={cn("relative block aspect-[63/88] w-full overflow-hidden rounded-[7px] bg-surface", on ? "ring-[2.5px] ring-accent" : "opacity-45")}
                >
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="grid size-full place-items-center p-1 text-center text-[10px] font-bold leading-tight">{c.name}</span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[11px] font-bold text-white tabular">
                    {c.price_cents != null ? formatBRL(c.price_cents).replace(",00", "") : "Pôr preço"}
                  </span>
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

      <p className="-mt-2 text-xs text-muted">Quem tocar primeiro em “Quero esta carta” leva pelo preço de cada uma.</p>

      <FormError message={error} />
      <Button block className="min-h-[72px] font-display text-xl" pending={pending} disabled={!picked.length} onClick={() => void create()}>
        {picked.length ? `Criar leilão com ${picked.length} ${picked.length === 1 ? "carta" : "cartas"}` : "Toque nas cartas"}
      </Button>
      <p className="-mt-2 text-center text-xs text-muted">O leilão já aparece para todos. Dá para mudar a ordem e o preço de cada carta depois.</p>

      {pricing && (
        <PriceSheet
          card={pricing}
          onClose={() => setPricing(null)}
          onSaved={(cents) => {
            setCards((list) => list.map((c) => (c.id === pricing.id ? { ...c, price_cents: cents } : c)));
            setPicked((s) => (s.includes(pricing.id) ? s : [...s, pricing.id]));
            setPricing(null);
            setError(null);
          }}
        />
      )}
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

/** Preço de uma carta antiga, cadastrada antes do preço ser obrigatório. Fica salvo na carta. */
function PriceSheet({ card, onClose, onSaved }: { card: FreeCard; onClose: () => void; onSaved: (cents: number) => void }) {
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const cents = parseBRL(value);
    if (!cents || cents <= 0) return setFieldError("Informe o preço, ex.: 25");
    if (cents > MAX_PRICE_CENTS) return setFieldError("O preço máximo é R$ 100.000");
    setPending(true);
    setError(null);
    try {
      const { error: dbError } = await createClient().from("cards").update({ price_cents: cents }).eq("id", card.id);
      if (dbError) setError("Não foi possível salvar. Tente de novo.");
      else return onSaved(cents);
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    }
    setPending(false);
  }

  return (
    <Sheet title={`Quanto custa ${card.name}?`} onClose={onClose}>
      <Field label="Preço (R$)" inputMode="decimal" placeholder="Ex.: 25" value={value} onChange={(e) => (setValue(e.target.value), setFieldError(undefined))} error={fieldError} />
      <FormError message={error} />
      <Button block className="min-h-[52px]" pending={pending} onClick={() => void save()}>
        Salvar preço
      </Button>
    </Sheet>
  );
}
