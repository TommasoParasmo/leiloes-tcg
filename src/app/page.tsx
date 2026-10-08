import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui/page-loading";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { EventCard } from "@/components/event-card";
import { Pill } from "@/components/ui/pill";
import { listEvents } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";


export default function Home() {
  return (
    <Suspense
      fallback={
        <>
          <AppBar />
          <PageLoading />
          <TabBar active="aovivo" />
        </>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const sb = await createClient();
  const [{ data: auth }, events] = await Promise.all([sb.auth.getUser(), listEvents(sb)]);
  const live = events.find((e) => e.status === "live");
  const upcoming = events.filter((e) => e.status === "scheduled").sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));

  return (
    <>
      <AppBar
        right={
          auth.user ? null : (
            <Link href="/entrar" className="flex min-h-12 items-center">
              <span className="rounded-pill bg-surface-2 px-3 py-1.5 text-xs font-bold">Entrar</span>
            </Link>
          )
        }
      />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-28">
        {live ? (
          <section className="relative overflow-hidden rounded-lg border border-line">
            {live.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={live.cover_url} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <Image src="/brand/hero.jpg" alt="" fill priority sizes="(max-width: 448px) 100vw, 448px" className="object-cover" />
            )}
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(9,10,18,.95)_40%),linear-gradient(135deg,rgba(124,92,255,.35),transparent)]" />
            <div className="theme-dark-scope relative flex min-h-[300px] flex-col justify-end gap-2 p-4">
              <Pill tone="live" dot className="self-start">
                AO VIVO AGORA
              </Pill>
              <h1 className="font-display text-2xl font-extrabold leading-tight">
                Leilão #{live.number} · {live.title}
              </h1>
              <p className="text-sm text-muted">{live.round_count} cartas</p>
              <Link href={`/sala/${live.id}`} className="mt-1 flex min-h-12 items-center justify-center rounded-md bg-accent font-bold text-on-accent shadow-accent">
                Entrar na sala
              </Link>
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-line bg-surface p-5">
            <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">Nenhum leilão ao vivo</p>
            <h1 className="mt-2 font-display text-xl font-bold">Leilões ao vivo de cartas colecionáveis</h1>
            <p className="mt-2 text-sm text-muted">Pokémon, One Piece, Magic, Lorcana e outros. Veja abaixo os próximos eventos.</p>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Próximos eventos</h2>
            <Link href="/eventos" className="-mr-2 flex min-h-12 items-center px-2 text-xs font-bold text-muted">
              Ver todos
            </Link>
          </div>
          {upcoming.length ? (
            upcoming.slice(0, 4).map((e, i) => <EventCard key={e.id} event={e} photo={i % 2 ? "/brand/evento-2.jpg" : "/brand/evento-1.jpg"} />)
          ) : (
            <p className="text-sm text-muted">Nenhum evento agendado ainda.</p>
          )}
        </section>

        {!auth.user && <p className="text-center text-xs text-muted">Visitantes assistem. Para dar lance, crie sua conta.</p>}
      </main>
      <TabBar active="aovivo" />
    </>
  );
}
