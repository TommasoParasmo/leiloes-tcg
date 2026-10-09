import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { EventForm } from "./event-form";

export const metadata: Metadata = { title: "Novo evento · Bate Carta" };

export default function NovoEventoPage() {
  return (
    <>
      <AppBar back="/painel/eventos" title="Novo evento" />
      <Suspense fallback={<PageLoading />}>
        <Guarded />
      </Suspense>
    </>
  );
}

async function Guarded() {
  await requireAdmin("/painel/eventos/novo");
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
      <EventForm />
    </main>
  );
}
