import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui/page-loading";
import { AccumulationCard } from "@/components/accumulation-card";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { myLots } from "@/lib/buyer";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Meus arremates · Bate Carta" };

export default function ArrematesPage() {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading />}>
        <Arremates />
      </Suspense>
      <TabBar active="arremates" />
    </>
  );
}

async function Arremates() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/entrar?next=/arremates");
  const lots = await myLots(sb);
  const open = lots.filter((l) => l.status === "open");
  const closed = lots.filter((l) => l.status !== "open");

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-28">
        <h1 className="font-display text-xl font-bold">Meus arremates</h1>
        {open.map((l) => (
          <AccumulationCard key={l.id} lot={l} />
        ))}
        {closed.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Lotes fechados</h2>
            {closed.map((l) => (
              <AccumulationCard key={l.id} lot={l} headingLevel={3} />
            ))}
          </section>
        )}
        {!lots.length && <p className="text-sm text-muted">Você ainda não arrematou nenhuma carta.</p>}
      </main>
  );
}
