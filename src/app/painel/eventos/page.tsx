import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav, StoreLink } from "@/components/admin/admin-nav";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { Pill, type PillTone } from "@/components/ui/pill";
import { requireAdmin } from "@/lib/admin";
import { eventDay } from "@/lib/events";

export const metadata: Metadata = { title: "Eventos · Painel · Bate Carta" };

const statusLabel: Record<string, [string, PillTone]> = {
  draft: ["Rascunho", "neutral"],
  scheduled: ["Agendado", "acc"],
  live: ["Ao vivo", "live"],
  finished: ["Encerrado", "neutral"],
  cancelled: ["Cancelado", "danger"],
};

export default function EventosAdminPage() {
  return (
    <>
      <AppBar right={<StoreLink />} />
      <AdminNav active="eventos" />
      <Suspense fallback={<PageLoading />}>
        <Eventos />
      </Suspense>
    </>
  );
}

async function Eventos() {
  const { sb, sellerId } = await requireAdmin("/painel/eventos");
  const { data } = await sb
    .from("events")
    .select("id, number, title, status, starts_at, rounds(id)")
    .eq("seller_id", sellerId)
    .order("number", { ascending: false })
    .limit(50);
  const events = (data ?? []) as { id: string; number: number; title: string; status: string; starts_at: string | null; rounds: { id: string }[] }[];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">Eventos</h1>
        <Link href="/painel/eventos/novo" className="flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-bold text-on-accent">
          Novo evento
        </Link>
      </div>
      {events.length ? (
        <ul className="flex flex-col gap-2">
          {events.map((e) => {
            const [label, tone] = statusLabel[e.status] ?? [e.status, "neutral"];
            const when = eventDay(e.starts_at);
            return (
              <li key={e.id}>
                <Link href={`/painel/eventos/${e.id}`} className="flex min-h-16 items-center gap-3 rounded-md border border-line bg-surface p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      Leilão #{e.number} · {e.title}
                    </p>
                    <p className="text-xs text-muted">
                      {[when && `${when.day}/${when.month} ${when.time}`, `${e.rounds.length} cartas`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Pill tone={tone} dot={e.status === "live"}>
                    {label}
                  </Pill>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="rounded-md border border-line bg-surface p-5 text-center">
          <p className="font-bold">Nenhum evento ainda</p>
          <p className="mt-1 text-sm text-muted">Cadastre suas cartas e crie o primeiro leilão.</p>
        </section>
      )}
    </main>
  );
}
