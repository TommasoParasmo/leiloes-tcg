"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { formatCountdown, remainingMs } from "@/lib/auction/logic";
import type { RoundState } from "@/lib/auction/types";
import { adminRpc, fetchEventRounds, fetchFreeCards, roundSummary, type FreeCard, type QueueRound } from "@/lib/admin-data";
import { formatBRL } from "@/lib/money";
import { whatsappShareUrl } from "@/lib/whatsapp/message";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Sheet } from "@/components/ui/sheet";
import { useCloseWhenExpired, useRoom, useTicker } from "@/components/room/use-room";
import { RoundSheet } from "./round-sheet";

export interface AdminEvent {
  id: string;
  number: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "finished" | "cancelled";
  shareUrl: string;
}

/**
 * Controle do evento no celular (design: tela 10). A rodada atual vem do mesmo estado
 * ao vivo da sala; a fila é relida a cada mudança. Todo botão chama uma função admin_*
 * no banco, que confere permissão e estado antes de agir.
 */
export function EventControl({ event, sellerId }: { event: AdminEvent; sellerId: string }) {
  const router = useRouter();
  const [sb] = useState(createClient);
  const room = useRoom(sb, event.id, { round: null, card: null });
  const [rounds, setRounds] = useState<QueueRound[]>([]);
  const [freeCards, setFreeCards] = useState<FreeCard[]>([]);
  const [eventStatus, setEventStatus] = useState(event.status);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "win"; text: string } | null>(null);
  // painel da rodada: "new" escolhe carta e configura; uma rodada da fila abre para editar
  const [sheet, setSheet] = useState<"new" | QueueRound | null>(null);
  // confirmação antes de tirar uma carta da fila
  const [removing, setRemoving] = useState<QueueRound | null>(null);

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
  }, [sb, event.id, sellerId, roundKey]);

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
          <Button
            block
            className="min-h-[52px]"
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
            {queued.length ? "Liberar próxima carta" : "Adicione cartas à fila"}
          </Button>
          {room.round?.status === "closed" && (
            <p className="text-center text-sm text-muted">
              Última: <b className="text-text">{room.card?.name}</b>{" "}
              {room.round.leading_nickname ? `· ${room.round.leading_nickname} · ${formatBRL(room.round.current_amount_cents ?? 0)}` : "· sem lances"}
            </p>
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
          {sheet && (
            <RoundSheet
              key={sheet === "new" ? "new" : sheet.id}
              sb={sb}
              eventId={event.id}
              ordinal={sheet === "new" ? rounds.length + 1 : rounds.findIndex((r) => r.id === sheet.id) + 1}
              cards={freeCards}
              editing={sheet === "new" ? undefined : sheet}
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
                      <span className="sr-only">Editar </span>
                      {r.card.name}
                    </span>
                    <span className="block truncate text-xs text-muted">{roundSummary(r)}</span>
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
                  {r.status === "cancelled" ? "Cancelada" : r.current_amount_cents != null ? formatBRL(r.current_amount_cents) : "Sem lances"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

  return (
    <section aria-label="Rodada atual" className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-2.5">
        {card?.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photos[0]} alt="" width={52} height={72} className="h-[72px] w-[52px] rounded-[5px] object-cover" />
        ) : (
          <span aria-hidden className="h-[72px] w-[52px] rounded-[5px] bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{card?.name ?? "…"}</p>
          <p className="text-xs text-muted">{roundSummary(round)}</p>
          <p className="text-xs tabular">
            {round.current_amount_cents != null ? (
              <>
                <b>{formatBRL(round.current_amount_cents)}</b> · {round.leading_nickname} · {round.bid_count} {round.bid_count === 1 ? "lance" : "lances"}
              </>
            ) : (
              <span className="text-muted">Sem lances ainda</span>
            )}
          </p>
        </div>
        <div className="text-right">
          {paused ? (
            <Pill tone="warn">Pausada</Pill>
          ) : remaining != null ? (
            <p suppressHydrationWarning className={`font-display text-xl font-extrabold tabular ${remaining <= 10_000 ? "text-live" : "text-accent-text"}`}>
              {formatCountdown(remaining)}
            </p>
          ) : (
            <Pill tone="live" dot>
              Aberta
            </Pill>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button variant="outline" pending={busy === "resume"} disabled={!!busy} onClick={onResume}>
            Retomar
          </Button>
        ) : (
          <Button variant="outline" pending={busy === "pause"} disabled={!!busy} onClick={onPause}>
            Pausar
          </Button>
        )}
        <Button variant="outline" pending={busy === "extend"} disabled={!!busy || round.close_mode !== "timer" || paused} onClick={onExtend}>
          +15 s
        </Button>
        <Button pending={busy === "close"} disabled={!!busy} onClick={() => setConfirmClose(true)}>
          Encerrar agora
        </Button>
        <Button variant="danger" disabled={!!busy} onClick={() => setCancelling((v) => !v)} aria-expanded={cancelling}>
          Cancelar rodada
        </Button>
      </div>
      {confirmClose && (
        <Sheet title="Encerrar a rodada agora?" onClose={() => setConfirmClose(false)}>
          <p className="text-sm text-muted">
            {round.leading_nickname && round.current_amount_cents != null
              ? `${round.leading_nickname} arremata ${card?.name ?? "a carta"} por ${formatBRL(round.current_amount_cents)}. Não dá para desfazer.`
              : "Ninguém deu lance: a carta volta a ficar livre para outro evento."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmClose(false)}>
              Continuar rodada
            </Button>
            <Button
              pending={busy === "close"}
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Encerrar
            </Button>
          </div>
        </Sheet>
      )}
      {cancelling && (
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
            Motivo do cancelamento
          </label>
          <input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: carta com defeito"
            maxLength={200}
            className="min-h-[46px] rounded-sm border border-line bg-surface px-3.5 text-md"
          />
          <p className="text-xs text-muted">Os lances desta rodada são descartados e ninguém arremata.</p>
          <Button type="submit" variant="danger" disabled={!reason.trim() || !!busy} pending={busy === "cancel"}>
            Confirmar cancelamento
          </Button>
        </form>
      )}
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
