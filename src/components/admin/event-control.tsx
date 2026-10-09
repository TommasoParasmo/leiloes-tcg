"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { breakRemainingMs, formatCountdown, remainingMs } from "@/lib/auction/logic";
import type { RoundState } from "@/lib/auction/types";
import { adminRpc, fetchEventRounds, fetchFreeCards, roundSummary, type FreeCard, type QueueRound } from "@/lib/admin-data";
import { formatBRL } from "@/lib/money";
import { whatsappShareUrl } from "@/lib/whatsapp/message";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Sheet } from "@/components/ui/sheet";
import { BreakBanner } from "@/components/room/break-banner";
import { useCloseWhenExpired, useRoom, useTicker } from "@/components/room/use-room";
import { EventCover } from "./event-cover";
import { SoldPanel } from "./sold-panel";
import { AddCardSheet, RoundPriceSheet } from "./speed-sheets";

export interface AdminEvent {
  id: string;
  number: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "finished" | "cancelled";
  shareUrl: string;
  coverUrl: string | null;
}

/**
 * Controle do evento no celular (design: tela 10). A rodada atual vem do mesmo estado
 * ao vivo da sala; a fila é relida a cada mudança. Todo botão chama uma função admin_*
 * no banco, que confere permissão e estado antes de agir.
 */
export function EventControl({ event, sellerId, newCardId, groupUrl }: { event: AdminEvent; sellerId: string; newCardId?: string; groupUrl: string | null }) {
  const router = useRouter();
  const [sb] = useState(createClient);
  const room = useRoom(sb, event.id, { round: null, card: null });
  const [rounds, setRounds] = useState<QueueRound[]>([]);
  const [freeCards, setFreeCards] = useState<FreeCard[]>([]);
  const [eventStatus, setEventStatus] = useState(event.status);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "win"; text: string } | null>(null);
  // "new" escolhe a carta e o preço; uma carta da fila abre o "Mudar preço"
  const [sheet, setSheet] = useState<"new" | QueueRound | null>(null);
  // confirmação antes de tirar uma carta da fila
  const [removing, setRemoving] = useState<QueueRound | null>(null);
  // escolha da duração do intervalo (pausa do leilão inteiro)
  const [breakSheet, setBreakSheet] = useState(false);
  const breakNow = useTicker(!!room.breakUntil);
  // carta recém-cadastrada a partir deste evento: abre o painel já com ela escolhida
  const [newCard, setNewCard] = useState<{ id: string; name: string } | null>(null);
  // a tela pode voltar com o estado preservado (navegação do Next), então compara com a última tratada
  const [handledNewCard, setHandledNewCard] = useState<string | null>(null);
  if (newCardId && newCardId !== handledNewCard) {
    const found = freeCards.find((c) => c.id === newCardId);
    if (found) {
      setHandledNewCard(newCardId);
      setNewCard({ id: found.id, name: found.name });
      setSheet("new");
    }
  }
  useEffect(() => {
    // tira o ?carta= da barra para um recarregar não reabrir o painel
    // (sem ida ao servidor, que remontaria a tela e perderia o painel aberto)
    if (newCardId) window.history.replaceState(null, "", `/painel/eventos/${event.id}`);
  }, [newCardId, event.id]);

  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([fetchEventRounds(sb, event.id), fetchFreeCards(sb, sellerId)]);
    setRounds(r);
    setFreeCards(c);
  }, [sb, event.id, sellerId]);

  // relê a fila quando a rodada atual muda de estado (aberta, encerrada, próxima)
  const roundKey = room.round ? `${room.round.id}:${room.round.status}` : "";
  useEffect(() => {
    let alive = true;
    Promise.all([fetchEventRounds(sb, event.id), fetchFreeCards(sb, sellerId)])
      .then(([r, c]) => {
        if (!alive) return;
        setRounds(r);
        setFreeCards(c);
      })
      .catch(() => alive && setMessage({ tone: "danger", text: "Não foi possível carregar a fila. Recarregue a página." }));
    return () => {
      alive = false;
    };
  }, [sb, event.id, sellerId, roundKey, newCardId]);

  async function act(label: string, fn: () => Promise<AuctionResult>, after?: (r: AuctionResult) => void) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    let result: AuctionResult;
    try {
      result = await fn();
      if (result.state) room.applyState(result.state as RoundState);
    } catch {
      // sem resposta não dá para saber se o servidor recebeu: a tela relê e mostra o estado real
      setMessage({ tone: "danger", text: "Sem resposta do servidor. Confira a tela antes de tentar de novo." });
      await Promise.all([room.refresh(), reload()]).catch(() => {});
      setBusy(null);
      return;
    }
    if (!result.ok) setMessage({ tone: "danger", text: auctionMessage(result) });
    else after?.(result);
    try {
      await Promise.all([room.refresh(), reload()]);
    } catch {
      // a ação já foi feita; só a atualização da tela falhou
      if (result.ok) setMessage({ tone: "danger", text: "Feito, mas a tela não atualizou. Recarregue a página." });
    }
    setBusy(null);
  }

  const active = room.round && (room.round.status === "open" || room.round.status === "paused") ? room.round : null;
  const queued = rounds.filter((r) => r.status === "queued");
  const done = rounds.filter((r) => r.status === "closed" || r.status === "cancelled");
  const finished = eventStatus === "finished" || eventStatus === "cancelled";

  async function move(index: number, delta: -1 | 1) {
    const ids = queued.map((r) => r.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await act("reorder", () => adminRpc(sb, "admin_reorder_queue", { p_event_id: event.id, p_round_ids: ids }));
  }

  /** Pular: a próxima carta vai para o fim da fila. */
  async function skip() {
    if (queued.length < 2) return;
    const ids = [...queued.slice(1), queued[0]].map((r) => r.id);
    await act("reorder", () => adminRpc(sb, "admin_reorder_queue", { p_event_id: event.id, p_round_ids: ids }));
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy("remove");
    const { error } = await sb.from("rounds").delete().eq("id", id);
    if (error) setMessage({ tone: "danger", text: "Não foi possível tirar a carta da fila." });
    await reload().catch(() => {});
    setBusy(null);
    setRemoving(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
      <p aria-live="polite" className="sr-only">
        {message?.text ?? ""}
      </p>
      {message && (
        <p className={message.tone === "danger" ? "rounded-sm bg-danger/15 px-3 py-2 text-sm font-semibold text-danger" : "rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win"}>
          {message.text}
        </p>
      )}

      {(room.eventStatus ?? eventStatus) === "live" &&
        (room.breakUntil ? (
          <BreakBanner remaining={breakRemainingMs(room.breakUntil, breakNow, room.offsetMs) ?? 0}>
            <Button className="mt-2 min-h-[52px] w-full" pending={busy === "break_end"} disabled={!!busy} onClick={() => act("break_end", () => adminRpc(sb, "admin_end_break", { p_event_id: event.id }))}>
              Voltar agora
            </Button>
          </BreakBanner>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setBreakSheet(true)} className="flex min-h-11 items-center justify-center rounded-md border border-line text-sm font-bold">
            Fazer intervalo
          </button>
        ))}
      {breakSheet && (
        <Sheet title="Intervalo" onClose={() => setBreakSheet(false)}>
          <p className="text-sm text-muted">A carta aberta congela e ninguém compra. Volta sozinho no fim do tempo, ou quando você tocar em “Voltar agora”.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[2, 5, 10].map((min) => (
              <Button
                key={min}
                className="min-h-[52px]"
                pending={busy === `break_${min}`}
                disabled={!!busy}
                onClick={() => {
                  setBreakSheet(false);
                  void act(`break_${min}`, () => adminRpc(sb, "admin_start_break", { p_event_id: event.id, p_minutes: min }));
                }}
              >
                {min} min
              </Button>
            ))}
          </div>
        </Sheet>
      )}

      {active ? (
        <ActiveRound
          round={active}
          card={room.card}
          offsetMs={room.offsetMs}
          sb={sb}
          applyState={room.applyState}
          busy={busy}
          onPause={() => act("pause", () => adminRpc(sb, "admin_pause_round", { p_round_id: active.id }))}
          onResume={() => act("resume", () => adminRpc(sb, "admin_resume_round", { p_round_id: active.id }))}
          onExtend={() => act("extend", () => adminRpc(sb, "admin_extend_round", { p_round_id: active.id, p_seconds: 15 }))}
          onClose={() => act("close", () => adminRpc(sb, "admin_close_round", { p_round_id: active.id }))}
          onCancel={(reason) => act("cancel", () => adminRpc(sb, "admin_cancel_round", { p_round_id: active.id, p_reason: reason }))}
        />
      ) : finished ? (
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Evento encerrado</p>
          <p className="mt-1 text-sm text-muted">{done.filter((r) => r.status === "closed").length} cartas vendidas. Confira a fila do WhatsApp.</p>
        </section>
      ) : eventStatus === "draft" ? (
        <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
          <p className="font-bold">Rascunho</p>
          <p className="text-sm text-muted">Só você vê este evento. Publique para ele aparecer em “Próximos eventos” e o link de divulgação funcionar.</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Link href={`/sala/${event.id}`} className="flex min-h-[52px] items-center justify-center rounded-md border border-line text-sm font-bold">
              Pré-visualizar
            </Link>
            <Button
              className="min-h-[52px]"
              disabled={!queued.length}
              pending={busy === "publish"}
              onClick={() =>
                act(
                  "publish",
                  () => adminRpc(sb, "admin_publish_event", { p_event_id: event.id }),
                  () => {
                    setEventStatus("scheduled");
                    setMessage({ tone: "win", text: "Evento publicado." });
                    router.refresh();
                  },
                )
              }
            >
              Publicar evento
            </Button>
          </div>
          {!queued.length && <p className="text-xs text-muted">Adicione pelo menos uma carta à fila para publicar.</p>}
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          {(room.round?.status === "closed" || room.round?.status === "cancelled") && <SoldPanel sb={sb} round={room.round} cardName={room.card?.name ?? null} groupUrl={groupUrl} />}
          <Button
            block
            className="min-h-[72px] font-display text-xl"
            disabled={!queued.length}
            pending={busy === "next"}
            onClick={() =>
              act(
                "next",
                () => adminRpc(sb, "admin_open_next_round", { p_event_id: event.id }),
                () => setEventStatus("live"),
              )
            }
          >
            {queued.length ? nextLabel(queued[0]) : "Acabaram as cartas"}
          </Button>
          {queued.length ? (
            <div className="flex justify-center gap-1 text-sm font-bold text-muted">
              <SmallAction disabled={!!busy || queued.length < 2} onClick={() => void skip()}>
                Pular
              </SmallAction>
              <span aria-hidden className="self-center">·</span>
              <SmallAction disabled={!!busy} onClick={() => setSheet(queued[0])}>
                Mudar preço
              </SmallAction>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">Adicione mais cartas abaixo ou encerre o leilão.</p>
          )}
        </section>
      )}

      {!finished && (
        <section aria-labelledby="fila" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 id="fila" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">
              Fila do evento · {queued.length}
            </h2>
            <button type="button" onClick={() => setSheet("new")} className="flex min-h-11 items-center px-2 text-sm font-bold text-accent-text">
              + Adicionar carta
            </button>
          </div>
          {sheet === "new" && (
            <AddCardSheet
              sb={sb}
              eventId={event.id}
              cards={freeCards}
              initialCard={newCard ?? undefined}
              onClose={() => {
                setSheet(null);
                setNewCard(null);
              }}
              onSaved={(text) => {
                setSheet(null);
                setNewCard(null);
                void reload();
                setMessage({ tone: "win", text });
              }}
            />
          )}
          {sheet && sheet !== "new" && (
            <RoundPriceSheet
              key={sheet.id}
              sb={sb}
              round={sheet}
              onClose={() => setSheet(null)}
              onSaved={(text) => {
                setSheet(null);
                void reload();
                setMessage({ tone: "win", text });
              }}
            />
          )}
          {removing && (
            <Sheet title={`Tirar ${removing.card.name} da fila?`} onClose={() => busy !== "remove" && setRemoving(null)}>
              <p className="text-sm text-muted">A carta volta para as cartas livres e pode entrar em outro evento.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy === "remove"} onClick={() => setRemoving(null)}>
                  Manter
                </Button>
                <Button variant="danger" pending={busy === "remove"} onClick={() => void remove(removing.id)}>
                  Tirar da fila
                </Button>
              </div>
            </Sheet>
          )}
          {queued.length ? (
            <ol className="flex flex-col gap-1.5">
              {queued.map((r, i) => (
                <li key={r.id} className="flex items-center gap-2 rounded-sm border border-line bg-surface p-2">
                  <span className="w-6 text-center font-display text-sm font-bold text-muted tabular">{String(i + 1).padStart(2, "0")}</span>
                  {r.card.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.card.photo} alt="" width={30} height={40} loading="lazy" className="h-10 w-[30px] rounded-[4px] object-cover" />
                  ) : (
                    <span aria-hidden className="h-10 w-[30px] rounded-[4px] bg-surface-2" />
                  )}
                  <button type="button" onClick={() => setSheet(r)} disabled={!!busy} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-bold">
                      <span className="sr-only">Mudar preço de </span>
                      {r.card.name}
                    </span>
                    <span className="block truncate text-xs text-muted">{r.mode === "speed" ? formatBRL(r.fixed_price_cents ?? 0) : roundSummary(r)}</span>
                  </button>
                  <div className="flex">
                    <IconButton label={`Subir ${r.card.name}`} disabled={i === 0 || !!busy} onClick={() => move(i, -1)}>
                      ↑
                    </IconButton>
                    <IconButton label={`Descer ${r.card.name}`} disabled={i === queued.length - 1 || !!busy} onClick={() => move(i, 1)}>
                      ↓
                    </IconButton>
                    <IconButton label={`Tirar ${r.card.name} da fila`} disabled={!!busy} onClick={() => setRemoving(r)}>
                      ✕
                    </IconButton>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Nenhuma carta na fila.</p>
          )}
        </section>
      )}

      {done.length > 0 && (
        <section aria-labelledby="vendidas" className="flex flex-col gap-1.5">
          <h2 id="vendidas" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">
            Já leiloadas · {done.length}
          </h2>
          <ul className="flex flex-col gap-1">
            {done.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{r.card.name}</span>
                <span className="shrink-0 text-muted tabular">
                  {r.status === "cancelled" ? "Cancelada" : r.current_amount_cents != null ? formatBRL(r.current_amount_cents) : "Ninguém levou"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!finished && <EventCover sb={sb} eventId={event.id} sellerId={sellerId} initialUrl={event.coverUrl} />}

      {eventStatus !== "draft" && (
        <section className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/sala/${event.id}`} className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 text-sm font-bold">
              Ver sala
            </Link>
            <a
              href={whatsappShareUrl(`🔥 Leilão #${event.number} · ${event.title}\nEntre na sala: ${event.shareUrl}`)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 text-sm font-bold"
            >
              Divulgar no WhatsApp
            </a>
          </div>
          {!finished && !active && (
            <FinishEvent
              busy={busy === "finish"}
              queued={queued.length}
              onConfirm={() => act("finish", () => adminRpc(sb, "admin_finish_event", { p_event_id: event.id }), () => setEventStatus("finished"))}
            />
          )}
        </section>
      )}
    </main>
  );
}

function ActiveRound({
  round,
  card,
  offsetMs,
  sb,
  applyState,
  busy,
  onPause,
  onResume,
  onExtend,
  onClose,
  onCancel,
}: {
  round: RoundState;
  card: { name: string; photos: string[] } | null;
  offsetMs: number;
  sb: ReturnType<typeof createClient>;
  applyState: (s: RoundState) => void;
  busy: string | null;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
  onClose: () => void;
  onCancel: (reason: string) => void;
}) {
  const now = useTicker(round.status === "open" && !!round.ends_at);
  const remaining = remainingMs(round, now, offsetMs);
  useCloseWhenExpired(sb, round, remaining, applyState);
  const [cancelling, setCancelling] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [reason, setReason] = useState("");
  const paused = round.status === "paused";
  const leader = round.leading_nickname && round.current_amount_cents != null;
  const speed = round.mode === "speed";

  const cancelForm = cancelling && (
    <form
      className="flex flex-col gap-2 rounded-md border border-danger/50 bg-danger/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        onCancel(reason.trim());
        setCancelling(false);
        setReason("");
      }}
    >
      <label htmlFor="cancel-reason" className="text-sm font-bold">
        Por que cancelar?
      </label>
      <input
        id="cancel-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ex.: carta com defeito"
        maxLength={200}
        className="min-h-[46px] rounded-sm border border-line bg-surface px-3.5 text-md"
      />
      <p className="text-xs text-muted">{speed ? "A carta sai do leilão e ninguém leva." : "Os lances desta carta são descartados e ninguém leva."}</p>
      <Button type="submit" variant="danger" disabled={!reason.trim() || !!busy} pending={busy === "cancel"}>
        Cancelar carta
      </Button>
    </form>
  );

  if (speed) {
    // rapidez: o botão está liberado; o primeiro toque confirmado leva e a carta fecha sozinha
    return (
      <section aria-label="Carta no ar" className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface p-3 text-center">
          {card?.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.photos[0]} alt="" width={120} height={168} className="h-[168px] w-[120px] rounded-[7px] object-cover" />
          ) : (
            <span aria-hidden className="h-[168px] w-[120px] rounded-[7px] bg-surface-2" />
          )}
          <p className="font-bold">{card?.name ?? "…"}</p>
          <Pill tone="live" dot>
            Botão liberado
          </Pill>
          <p className="text-sm">
            Quem tocar primeiro leva por <b className="tabular">{formatBRL(round.fixed_price_cents ?? 0)}</b>
          </p>
        </div>

        {confirmClose ? (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
            <p className="text-sm">Ninguém tocou ainda. A carta volta para as cartas livres e você pode leiloar de novo outro dia.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmClose(false)}>
                Esperar mais
              </Button>
              <Button
                pending={busy === "close"}
                onClick={() => {
                  setConfirmClose(false);
                  onClose();
                }}
              >
                Ninguém quis
              </Button>
            </div>
          </div>
        ) : (
          <Button block variant="secondary" className="min-h-[56px]" pending={busy === "close"} disabled={!!busy} onClick={() => setConfirmClose(true)}>
            Ninguém quis? Fechar a carta
          </Button>
        )}

        <div className="flex justify-center text-sm font-bold text-muted">
          <SmallAction disabled={!!busy} onClick={() => setCancelling((v) => !v)} aria-expanded={cancelling}>
            Cancelar carta
          </SmallAction>
        </div>
        {cancelForm}
      </section>
    );
  }

  return (
    <section aria-label="Carta no ar" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-2.5">
        {card?.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photos[0]} alt="" width={52} height={72} className="h-[72px] w-[52px] rounded-[5px] object-cover" />
        ) : (
          <span aria-hidden className="h-[72px] w-[52px] rounded-[5px] bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{card?.name ?? "…"}</p>
          <p className="text-sm tabular">
            {leader ? (
              <>
                <b className="text-lg">{formatBRL(round.current_amount_cents ?? 0)}</b> · {round.leading_nickname}
              </>
            ) : (
              <span className="text-muted">Sem lances ainda</span>
            )}
          </p>
        </div>
      </div>

      <div className="py-1 text-center">
        {paused ? (
          <p className="font-display text-4xl font-extrabold text-warn">Pausada</p>
        ) : remaining != null ? (
          <p suppressHydrationWarning aria-label="Tempo restante" className={`font-display text-[72px] font-extrabold leading-none tabular ${remaining <= 10_000 ? "text-live" : "text-accent-text"}`}>
            {formatCountdown(remaining)}
          </p>
        ) : (
          <Pill tone="live" dot>
            Aberta
          </Pill>
        )}
        {!paused && remaining != null && <p className="mt-1 text-xs text-muted">A carta fecha sozinha no fim do tempo.</p>}
      </div>

      {confirmClose ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <p className="text-sm">
            {leader
              ? `${round.leading_nickname} leva ${card?.name ?? "a carta"} por ${formatBRL(round.current_amount_cents ?? 0)}. Não dá para desfazer.`
              : "Ninguém deu lance: a carta volta para as cartas livres."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmClose(false)}>
              Continuar
            </Button>
            <Button
              pending={busy === "close"}
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Sim, fechar
            </Button>
          </div>
        </div>
      ) : (
        <Button block className="min-h-[72px] font-display text-xl" pending={busy === "close"} disabled={!!busy} onClick={() => setConfirmClose(true)}>
          Fechar agora
        </Button>
      )}

      <div className="flex justify-center gap-1 text-sm font-bold text-muted">
        {paused ? (
          <SmallAction disabled={!!busy} onClick={onResume}>
            Continuar
          </SmallAction>
        ) : (
          <SmallAction disabled={!!busy} onClick={onPause}>
            Pausar
          </SmallAction>
        )}
        <span aria-hidden className="self-center">·</span>
        <SmallAction disabled={!!busy || round.close_mode !== "timer" || paused} onClick={onExtend}>
          +15 s
        </SmallAction>
        <span aria-hidden className="self-center">·</span>
        <SmallAction disabled={!!busy} onClick={() => setCancelling((v) => !v)} aria-expanded={cancelling}>
          Cancelar carta
        </SmallAction>
      </div>
      {cancelForm}
      {round.recent_bids.length > 0 && (
        <div>
          <Kicker className="mb-1">Últimos lances</Kicker>
          <ul className="flex flex-col gap-0.5 text-sm">
            {round.recent_bids.map((b) => (
              <li key={b.seq} className="flex justify-between">
                <span>{b.nickname}</span>
                <span className="text-muted tabular">{formatBRL(b.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SmallAction({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="min-h-11 px-2 underline-offset-2 hover:underline disabled:opacity-40" {...rest}>
      {children}
    </button>
  );
}

function FinishEvent({ busy, queued, onConfirm }: { busy: boolean; queued: number; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Encerrar evento
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <p className="text-sm">
        {queued ? `${queued} ${queued === 1 ? "carta ainda está" : "cartas ainda estão"} na fila e ${queued === 1 ? "volta" : "voltam"} a ficar livre${queued === 1 ? "" : "s"}. ` : ""}
        Depois de encerrado, o evento não abre mais rodadas.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Voltar
        </Button>
        <Button pending={busy} onClick={onConfirm}>
          Encerrar
        </Button>
      </div>
    </div>
  );
}

function IconButton({ label, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} className="grid size-11 place-items-center rounded-sm text-lg text-muted disabled:opacity-30" {...rest}>
      {children}
    </button>
  );
}

/** Botão grande do ao vivo: rapidez libera o botão de compra; rodada antiga de lances só abre. */
function nextLabel(r: QueueRound): string {
  return r.mode === "speed" && r.fixed_price_cents != null ? `Liberar o botão: ${r.card.name} · ${formatBRL(r.fixed_price_cents)}` : `Abrir: ${r.card.name}`;
}
