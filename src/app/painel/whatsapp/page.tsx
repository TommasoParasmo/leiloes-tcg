import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { WhatsappQueue, type QueueMessage } from "@/components/admin/whatsapp-queue";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { publicEnv } from "@/lib/env";
import { buildRoundResultMessage, type RoundResultPayload } from "@/lib/whatsapp/message";

export const metadata: Metadata = { title: "WhatsApp · Painel · Bate Carta" };

export default function WhatsappPage() {
  return (
    <>
      <AppBar right={<span className="text-xs font-bold text-muted">Leiloeiro</span>} />
      <AdminNav active="whatsapp" />
      <Suspense fallback={<PageLoading />}>
        <Fila />
      </Suspense>
    </>
  );
}

async function Fila() {
  const { sb, sellerId } = await requireAdmin("/painel/whatsapp");
  const { data } = await sb
    .from("whatsapp_messages")
    .select("id, status, payload, last_error, sent_at, created_at")
    .eq("seller_id", sellerId)
    .eq("kind", "round_result")
    .order("created_at", { ascending: false })
    .limit(100);
  const messages: QueueMessage[] = (data ?? []).map((m) => {
    const p = m.payload as RoundResultPayload;
    return {
      id: m.id,
      status: m.status,
      lastError: m.last_error,
      sentAt: m.sent_at,
      text: buildRoundResultMessage(p, publicEnv.siteUrl),
      photo: p.photo_path ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(p.photo_path).data.publicUrl : null,
    };
  });
  return <WhatsappQueue initial={messages} />;
}
