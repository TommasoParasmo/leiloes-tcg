import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchCard, fetchEvent, fetchRoomState } from "@/lib/auction/data";
import { eventPreview } from "@/lib/share-preview";
import { LiveRoom } from "@/components/room/live-room";
import { TabBar } from "@/components/layout/tab-bar";
import { PageLoading } from "@/components/ui/page-loading";

type Params = Promise<{ eventoId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { eventoId } = await params;
  if (!UUID.test(eventoId)) return { title: "Sala ao vivo · Bate Carta" };
  return eventPreview(await createClient(), eventoId);
}

export default function SalaPage({ params }: { params: Params }) {
  return (
    <>
      <Suspense fallback={<PageLoading rows={4} />}>
        <Sala params={params} />
      </Suspense>
      <TabBar active="aovivo" />
    </>
  );
}

async function Sala({ params }: { params: Params }) {
  const { eventoId } = await params;
  if (!UUID.test(eventoId)) notFound();
  const sb = await createClient();
  const event = await fetchEvent(sb, eventoId);
  if (!event) notFound();

  const [room, { data: auth }, { data: ev }] = await Promise.all([
    fetchRoomState(sb, event.id),
    sb.auth.getUser(),
    sb.from("events").select("seller_id").eq("id", event.id).maybeSingle<{ seller_id: string }>(),
  ]);
  // o botão de esconder mensagem só aparece para o leiloeiro; o servidor confere de novo
  const canModerate = !!auth.user && !!ev && (await sb.rpc("app_is_admin", { p_seller: ev.seller_id })).data === true;
  const round = room?.state ?? null;
  const card = round ? await fetchCard(sb, round.card_id) : null;

  return <LiveRoom event={room ? { ...event, status: room.event_status } : event} initialRound={round} initialCard={card} viewer={{ loggedIn: !!auth.user, canModerate }} />;
}
