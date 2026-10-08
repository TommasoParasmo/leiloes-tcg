import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui/page-loading";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { EventCard } from "@/components/event-card";
import { listEvents } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Eventos · Bate Carta" };

export default function EventosPage() {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading />}>
        <Eventos />
      </Suspense>
      <TabBar active="eventos" />
    </>
  );
}

async function Eventos() {
  const events = await listEvents(await createClient());
  const groups = [
    { title: "Ao vivo", items: events.filter((e) => e.status === "live") },
    { title: "Próximos", items: events.filter((e) => e.status === "scheduled") },
    { title: "Anteriores", items: events.filter((e) => e.status === "finished" || e.status === "cancelled") },
  ].filter((g) => g.items.length);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-28">
        <h1 className="font-display text-xl font-bold">Eventos</h1>
        {groups.length ? (
          groups.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <h2 className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">{g.title}</h2>
              {g.items.map((e, i) => (
                <EventCard key={e.id} event={e} photo={i % 2 ? "/brand/evento-2.jpg" : "/brand/evento-1.jpg"} />
              ))}
            </section>
          ))
        ) : (
          <p className="text-sm text-muted">Nenhum evento publicado ainda.</p>
        )}
      </main>
  );
}
