"use client";
import { useEffect, useState } from "react";
import { adminRpc } from "@/lib/admin-data";
import type { RoundState } from "@/lib/auction/types";
import { publicEnv } from "@/lib/env";
import { formatBRL } from "@/lib/money";
import type { createClient } from "@/lib/supabase/client";
import { buildRoundResultMessage, groupNotice, type RoundResultPayload } from "@/lib/whatsapp/message";

type Sb = ReturnType<typeof createClient>;
type Notice = { id: string; text: string; sent: boolean };

/**
 * Depois que a carta fecha: quem levou e por quanto, e o "Avisar no grupo" com o texto do
 * resultado já pronto (o mesmo da fila do WhatsApp). Tocar marca a mensagem como publicada.
 */
export function SoldPanel({ sb, round, cardName, groupUrl }: { sb: Sb; round: RoundState; cardName: string | null; groupUrl: string | null }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const sold = round.status === "closed" && round.leading_nickname != null && round.current_amount_cents != null;

  useEffect(() => {
    let alive = true;
    // a mensagem nasce junto com o fechamento; se ainda não chegou, tenta mais uma vez
    const load = async (retry: boolean) => {
      const { data } = await sb
        .from("whatsapp_messages")
        .select("id, status, payload")
        .eq("kind", "round_result")
        .eq("payload->>round_id", round.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      if (data) setNotice({ id: data.id, text: buildRoundResultMessage(data.payload as RoundResultPayload, publicEnv.siteUrl), sent: data.status === "sent" });
      else if (retry) setTimeout(() => void load(false), 1500);
    };
    void load(true);
    return () => {
      alive = false;
    };
  }, [sb, round.id]);

  async function avisar(n: Notice) {
    const link = groupNotice(n.text, groupUrl);
    if (link.copy) {
      // copia no mesmo toque: o navegador só deixa copiar durante o toque
      navigator.clipboard?.writeText(n.text).then(
        () => setCopied(true),
        () => {},
      );
    }
    setNotice({ ...n, sent: true });
    await adminRpc(sb, "admin_whatsapp_mark", { p_message_id: n.id, p_sent: true, p_error: null }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4 text-center">
      {round.status === "cancelled" ? (
        <p className="font-bold">{cardName ?? "A carta"} foi cancelada</p>
      ) : sold ? (
        <>
          <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-win">Vendida</p>
          <p className="font-display text-lg font-bold">
            {round.leading_nickname} levou {cardName ?? "a carta"} por {formatBRL(round.current_amount_cents ?? 0)}
          </p>
          <p className="text-xs text-muted">A compra já aparece na conta de quem levou.</p>
        </>
      ) : (
        <p className="font-bold">{cardName ?? "A carta"} ficou sem lances e voltou para as cartas livres</p>
      )}
      {notice && round.status === "closed" && (
        <>
          <a
            href={groupNotice(notice.text, groupUrl).href}
            target="_blank"
            rel="noreferrer"
            onClick={() => void avisar(notice)}
            className="flex min-h-[52px] items-center justify-center rounded-md bg-[#25D366] font-bold text-[#06210f]"
          >
            {notice.sent ? "Avisar no grupo de novo" : "Avisar no grupo"}
          </a>
          {groupUrl && <p className="text-xs text-muted">{copied ? "Texto copiado. No grupo, segure o campo e toque em Colar." : "O texto vai copiado: no grupo, é só colar e enviar."}</p>}
        </>
      )}
    </div>
  );
}
