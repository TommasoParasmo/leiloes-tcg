import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { CardForm } from "./card-form";

export const metadata: Metadata = { title: "Cadastrar carta · Bate Carta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NovaCartaPage({ searchParams }: PageProps<"/painel/cartas/nova">) {
  return (
    <Suspense
      fallback={
        <>
          <AppBar back="/painel/cartas" title="Cadastrar carta" />
          <PageLoading />
        </>
      }
    >
      <Form searchParams={searchParams} />
    </Suspense>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/painel/cartas/nova">, "searchParams">) {
  const { evento } = await searchParams;
  // aberta pelo "Adicionar carta" de um evento: volta para ele com a carta escolhida
  const eventId = typeof evento === "string" && UUID.test(evento) ? evento : undefined;
  const { sellerId } = await requireAdmin(eventId ? `/painel/cartas/nova?evento=${eventId}` : "/painel/cartas/nova");
  return (
    <>
      <AppBar back={eventId ? `/painel/eventos/${eventId}` : "/painel/cartas"} title="Cadastrar carta" />
      <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
        <CardForm sellerId={sellerId} eventId={eventId} />
      </main>
    </>
  );
}
