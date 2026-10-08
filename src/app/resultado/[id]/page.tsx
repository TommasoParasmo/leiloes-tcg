import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { CardArt } from "@/components/room/card-art";
import { CardTitle } from "@/components/room/card-title";
import { LostCard } from "@/components/room/result-cards";
import { PageLoading } from "@/components/ui/page-loading";
import { fetchCard, fetchEvent, fetchRoundState } from "@/lib/auction/data";
import { resultPreview } from "@/lib/share-preview";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/resultado/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Resultado · Bate Carta" };
  return resultPreview(await createClient(), id);
}

/** Link da mensagem do grupo: prova pública de quem arrematou, por quanto e quando. */
export default function ResultadoPage({ params }: PageProps<"/resultado/[id]">) {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading rows={3} />}>
        <Resultado params={params} />
      </Suspense>
      <TabBar active="eventos" />
    </>
  );
}

async function Resultado({ params }: { params: PageProps<"/resultado/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createClient();
  const round = await fetchRoundState(sb, id);
  if (!round) notFound();
  const [card, event] = await Promise.all([fetchCard(sb, round.card_id), fetchEvent(sb, round.event_id)]);
  if (!card || !event) notFound();
  const finished = round.status === "closed" || round.status === "cancelled";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-28">
      <CardArt photos={card.photos} label={`Leilão #${event.number} · ${round.ordinal}/${round.round_total}`} alt={card.name} />
      <CardTitle card={card} />
      {round.status === "cancelled" ? (
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Rodada cancelada pelo leiloeiro</p>
        </section>
      ) : finished ? (
        <LostCard winner={round.leading_nickname} amountCents={round.current_amount_cents} at={round.closed_at} withMs={round.mode === "speed"} />
      ) : (
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Esta carta ainda está em leilão</p>
        </section>
      )}
      <Link href={`/sala/${event.id}`} className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
        {event.status === "live" ? "Entrar na sala ao vivo" : `Ver Leilão #${event.number}`}
      </Link>
      <p className="text-center text-xs text-muted">Resultado registrado pelo servidor do Bate Carta, com horário oficial.</p>
    </main>
  );
}
