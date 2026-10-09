import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { fetchFreeCards } from "@/lib/admin-data";
import { EventForm } from "./event-form";

export const metadata: Metadata = { title: "Criar leilão · Bate Carta" };

export default function NovoEventoPage() {
  return (
    <>
      <AppBar back="/painel" title="Criar leilão" />
      <Suspense fallback={<PageLoading />}>
        <Guarded />
      </Suspense>
    </>
  );
}

async function Guarded() {
  const { sb, sellerId } = await requireAdmin("/painel/eventos/novo");
  const cards = await fetchFreeCards(sb, sellerId);
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
      <EventForm cards={cards} now={new Date().getTime()} />
    </main>
  );
}
