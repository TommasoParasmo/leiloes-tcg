import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchCard, fetchEvent, fetchRoomState } from "@/lib/auction/data";
import { LiveRoom } from "@/components/room/live-room";
import { TabBar } from "@/components/layout/tab-bar";
import { PageLoading } from "@/components/ui/page-loading";

type Params = Promise<{ eventoId: string }>;

export const metadata: Metadata = { title: "Sala ao vivo · Bate Carta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const room = await fetchRoomState(sb, event.id);
  const round = room?.state ?? null;
  const card = round ? await fetchCard(sb, round.card_id) : null;

  return <LiveRoom event={room ? { ...event, status: room.event_status } : event} initialRound={round} initialCard={card} />;
}
