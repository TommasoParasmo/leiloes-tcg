import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchCard, fetchEvent, fetchRoundState, pickRoomRoundId } from "@/lib/auction/data";
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

  const roundId = await pickRoomRoundId(sb, event.id);
  const round = roundId ? await fetchRoundState(sb, roundId) : null;
  const card = round ? await fetchCard(sb, round.card_id) : null;

  return <LiveRoom event={event} initialRound={round} initialCard={card} />;
}
