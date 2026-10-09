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
  const [cards, { data: s }] = await Promise.all([
    fetchFreeCards(sb, sellerId),
    sb.from("sellers").select("default_start_price_cents, default_increments_cents, default_duration_seconds").eq("id", sellerId).maybeSingle(),
  ]);
  const defaults = {
    startCents: Number(s?.default_start_price_cents ?? 500),
    incrementsCents: ((s?.default_increments_cents as number[] | null) ?? [100, 200, 500]).map(Number),
    seconds: Number(s?.default_duration_seconds ?? 20),
  };
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
      <EventForm cards={cards} defaults={defaults} now={new Date().getTime()} />
    </main>
  );
}
