import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EventControl, type AdminEvent } from "@/components/admin/event-control";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { Pill } from "@/components/ui/pill";
import { requireAdmin } from "@/lib/admin";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Controle do evento · Bate Carta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EventoPage({ params }: PageProps<"/painel/eventos/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <AppBar back="/painel" title="Evento" />
          <PageLoading rows={4} />
        </>
      }
    >
      <Evento params={params} />
    </Suspense>
  );
}

async function Evento({ params }: { params: PageProps<"/painel/eventos/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { sb, sellerId } = await requireAdmin(`/painel/eventos/${id}`);
  const { data } = await sb.from("events").select("id, number, title, status, share_slug, seller_id").eq("id", id).maybeSingle();
  if (!data || data.seller_id !== sellerId) notFound();
  const event: AdminEvent = {
    id: data.id,
    number: data.number,
    title: data.title,
    status: data.status,
    shareUrl: `${publicEnv.siteUrl}/e/${data.share_slug}`,
  };
  return (
    <>
      <AppBar
        back="/painel"
        title={`Leilão #${event.number}`}
        right={
          event.status === "live" ? (
            <Pill tone="live" dot>
              Ao vivo
            </Pill>
          ) : event.status === "finished" ? (
            <Pill>Encerrado</Pill>
          ) : event.status === "draft" ? (
            <Pill>Rascunho</Pill>
          ) : (
            <Pill tone="acc">Agendado</Pill>
          )
        }
      />
      <p className="mx-auto -mt-1 w-full max-w-md truncate px-4 text-sm text-muted">{event.title}</p>
      <EventControl event={event} sellerId={sellerId} />
    </>
  );
}
