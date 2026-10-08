"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { buyNow, placeBid, withOneRetry } from "@/lib/auction/data";
import { bidBoxTone, bidChoices, newIdempotencyKey, remainingMs, timerProgress } from "@/lib/auction/logic";
import type { CardInfo, EventInfo, RoundState } from "@/lib/auction/types";
import { formatBRL } from "@/lib/money";
import { Pill } from "@/components/ui/pill";
import { BidBox } from "./bid-box";
import { BidButtons } from "./bid-buttons";
import { BidHistory } from "./bid-history";
import { BuyButton } from "./buy-button";
import { CardArt } from "./card-art";
import { CardTitle } from "./card-title";
import { BlockedNotice, ReconnectBanner, RoomToast } from "./notices";
import { LostCard, WinnerCard, WonNextSteps } from "./result-cards";
import { useCloseWhenExpired, useRoom, useTicker } from "./use-room";

type Toast = { tone: "live" | "danger" | "neutral"; text: string; detail?: string } | null;

export function LiveRoom({ event, initialRound, initialCard }: { event: EventInfo; initialRound: RoundState | null; initialCard: CardInfo | null }) {
  const [sb] = useState(createClient);
  const room = useRoom(sb, event.id, { round: initialRound, card: initialCard });
  const { round, card } = room;

  const hasTimer = round?.status === "open" && !!round.ends_at;
  const now = useTicker(hasTimer);
  const remaining = round ? remainingMs(round, now, room.offsetMs) : null;
  useCloseWhenExpired(sb, round, remaining, room.applyState);

  const [pendingRaw, setPending] = useState<{ amount: number | null; roundId: string } | null>(null);
  // Ao trocar de rodada, nada pendente da anterior continua valendo.
  const pending = pendingRaw && pendingRaw.roundId === round?.id ? pendingRaw : null;
  const [toast, setToast] = useState<Toast>(null);

  // Lance superado: compara o estado anterior com o novo (aviso some em 4 s).
  const prev = useRef(round);
  useEffect(() => {
    const before = prev.current;
    prev.current = round;
    if (!before || !round || before.id !== round.id) return;
    if (before.leading_is_me && !round.leading_is_me && round.status === "open" && round.current_amount_cents != null) {
      setToast({
        tone: "live",
        text: "Seu lance foi superado",
        detail: `${round.leading_nickname ?? ""} · ${formatBRL(round.current_amount_cents)}`,
      });
    }
  }, [round]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  async function submit(amount: number | null) {
    if (!round || pending) return;
    const key = newIdempotencyKey();
    setPending({ amount, roundId: round.id });
    setToast(null);
    try {
      const result: AuctionResult = await withOneRetry(() =>
        amount == null ? buyNow(sb, round.id, key) : placeBid(sb, round.id, amount, key),
      );
      if (result.state) room.applyState(result.state as RoundState);
      if (!result.ok) setToast({ tone: "danger", text: auctionMessage(result) });
      else if (result.code === "tie_not_leading") setToast({ tone: "neutral", text: auctionMessage(result) });
    } catch {
      setToast({ tone: "danger", text: "Sem conexão com o servidor. Seu lance não foi confirmado, tente de novo." });
      void room.refresh().catch(() => {});
    } finally {
      setPending(null);
    }
  }

  if (!round || !card) {
    return (
      <Shell event={event} round={round} reconnecting={room.reconnecting} announce={{ polite: "", assertive: "" }}>
        <section className="rounded-md border border-line bg-surface p-5 text-center">
          <h1 className="font-bold">A primeira carta ainda não foi liberada</h1>
          <p className="mt-1 text-sm text-muted">Fique nesta tela: ela atualiza sozinha quando o leiloeiro começar.</p>
        </section>
      </Shell>
    );
  }

  const label = `Leilão #${event.number} · ${round.ordinal}/${round.round_total}`;
  const closed = round.status === "closed" || round.status === "cancelled";
  const iWon = round.status === "closed" && round.leading_is_me;
  const block = round.my_block;

  // Anúncios para leitores de tela: a região fica sempre montada e só o texto muda.
  const toastText = toast ? [toast.text, toast.detail].filter(Boolean).join(". ") : "";
  const speedOpen = round.mode === "speed" && round.status === "open";
  const announce = {
    assertive: toast?.tone === "live" ? toastText : speedOpen ? "Rodada liberada. Arremate agora." : "",
    polite:
      toast && toast.tone !== "live"
        ? toastText
        : round.status === "cancelled"
          ? "Rodada cancelada pelo leiloeiro."
          : iWon
            ? `Você arrematou ${card.name} por ${formatBRL(round.current_amount_cents ?? 0)}.`
            : closed && round.leading_nickname
              ? `${round.leading_nickname} ${round.mode === "speed" ? "arrematou primeiro" : "venceu"}.`
              : round.status === "paused"
                ? "Rodada pausada pelo leiloeiro."
                : "",
  };

  return (
    <Shell event={event} round={round} reconnecting={room.reconnecting} announce={announce}>
      {toast && <RoomToast {...toast} />}
      <CardArt photos={card.photos} label={label} alt={card.name} />
      <CardTitle card={card} extra={round.mode === "speed" && round.fixed_price_cents != null ? `Preço fixo ${formatBRL(round.fixed_price_cents)}` : undefined} />

      {round.status === "cancelled" ? (
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Rodada cancelada pelo leiloeiro</p>
          <p className="mt-1 text-sm text-muted">Aguarde a próxima carta.</p>
        </section>
      ) : iWon ? (
        <>
          <WinnerCard amountCents={round.current_amount_cents ?? 0} cardName={card.name} at={round.closed_at} />
          <WonNextSteps />
        </>
      ) : closed ? (
        <LostCard winner={round.leading_nickname} amountCents={round.current_amount_cents} at={round.closed_at} withMs={round.mode === "speed"} />
      ) : round.mode === "speed" ? (
        <SpeedControls round={round} block={block} pending={pending != null} onBuy={() => submit(null)} />
      ) : (
        <>
          <BidBox state={round} remaining={remaining} progress={timerProgress(round, remaining)} tone={bidBoxTone(round, remaining)} />
          <BidControls round={round} block={block} pendingAmount={pending?.amount ?? null} busy={pending != null} onBid={(a) => submit(a)} />
          <BidHistory bids={round.recent_bids} />
        </>
      )}
    </Shell>
  );
}

function Shell({
  event,
  round,
  reconnecting,
  announce,
  children,
}: {
  event: EventInfo;
  round: RoundState | null;
  reconnecting: boolean;
  announce: { polite: string; assertive: string };
  children: React.ReactNode;
}) {
  const pill =
    round?.status === "open" ? (
      round.mode === "speed" ? <Pill tone="live" dot>Liberado</Pill> : <Pill tone="live" dot>Ao vivo</Pill>
    ) : round?.status === "paused" ? (
      <Pill tone="warn">Pausado</Pill>
    ) : round?.status === "closed" || round?.status === "cancelled" ? (
      <Pill>Encerrada</Pill>
    ) : round?.mode === "speed" ? (
      <Pill tone="acc">Rapidez</Pill>
    ) : (
      <Pill>{event.status === "live" ? "Ao vivo" : "Em breve"}</Pill>
    );
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <ReconnectBanner show={reconnecting} />
      <p aria-live="polite" className="sr-only">
        {announce.polite}
      </p>
      <p aria-live="assertive" className="sr-only">
        {announce.assertive}
      </p>
      <header className="flex min-h-14 items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
        <Link href="/" aria-label="Bate Carta, início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/batecarta-logo-escuro.svg" alt="Bate Carta" width={125} height={24} className="h-6 w-auto" />
        </Link>
        {pill}
      </header>
      <main className="flex flex-col gap-3 px-4 pb-28">{children}</main>
    </div>
  );
}

function BidControls({
  round,
  block,
  pendingAmount,
  busy,
  onBid,
}: {
  round: RoundState;
  block: RoundState["my_block"];
  pendingAmount: number | null;
  busy: boolean;
  onBid: (amount: number) => void;
}) {
  if (block === "not_authenticated") return <LoginToBid />;
  if (block) return <BlockedNotice reason={block} />;
  const fixed = !!round.bid_options_cents?.length;
  return (
    <div className="flex flex-col gap-2">
      {fixed && <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Escolha seu lance</p>}
      <BidButtons choices={bidChoices(round)} fixedOptions={fixed} pendingAmount={busy ? (pendingAmount ?? -1) : null} onBid={onBid} />
      {round.status === "paused" && <p className="text-center text-sm text-warn">Rodada pausada pelo leiloeiro.</p>}
      {fixed && <p className="text-center text-xs text-muted">Opções abaixo do lance atual ficam desativadas. Lances não podem ser cancelados.</p>}
    </div>
  );
}

function SpeedControls({ round, block, pending, onBuy }: { round: RoundState; block: RoundState["my_block"]; pending: boolean; onBuy: () => void }) {
  if (block === "not_authenticated") return <LoginToBid />;
  if (block) return <BlockedNotice reason={block} />;
  const state = pending ? "pending" : round.status === "open" ? "ready" : "waiting";
  return <BuyButton state={state} priceCents={round.fixed_price_cents ?? 0} onBuy={onBuy} />;
}

function LoginToBid() {
  return (
    <section className="rounded-md border border-line bg-surface p-4 text-center">
      <p className="font-bold">Visitantes assistem. Para dar lance, entre na sua conta.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href="/entrar" className="flex min-h-12 items-center justify-center rounded-md bg-accent font-bold text-on-accent">
          Entrar
        </Link>
        <Link href="/cadastro" className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
          Criar conta
        </Link>
      </div>
    </section>
  );
}
