import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { createClient } from "@/lib/supabase/server";
import { MarkRead } from "./mark-read";

export const metadata: Metadata = { title: "Avisos · Bate Carta" };

const whenFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Notice = { id: string; kind: string; title: string; body: string | null; data: { order_id?: string; round_id?: string }; read_at: string | null; created_at: string };

/** Para onde cada aviso leva (pedido, resultado ou conta). */
function hrefOf(n: Notice): string | null {
  if (n.data.order_id) return `/conta/pedidos/${n.data.order_id}`;
  if (n.data.round_id) return `/resultado/${n.data.round_id}`;
  if (["penalty", "blocked", "unblocked"].includes(n.kind)) return "/conta";
  return null;
}

export default function AvisosPage() {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading />}>
        <Avisos />
      </Suspense>
      <TabBar active="conta" />
    </>
  );
}

async function Avisos() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/entrar?next=/conta/avisos");
  const { data } = await sb.from("notifications").select("id, kind, title, body, data, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  const notices = (data ?? []) as Notice[];
  const unreadIds = notices.filter((n) => !n.read_at).map((n) => n.id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-28">
      <h1 className="font-display text-xl font-bold">Avisos</h1>
      {unreadIds.length > 0 && <MarkRead ids={unreadIds} />}
      {notices.length === 0 ? (
        <p className="rounded-md border border-line bg-surface p-5 text-center text-sm text-muted">Nenhum aviso ainda. Lances superados, arremates, Pix e envio aparecem aqui.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notices.map((n) => {
            const href = hrefOf(n);
            const inner = (
              <>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-bold">
                    {!n.read_at && <span aria-label="Novo" className="mr-1.5 inline-block size-2 rounded-full bg-live align-middle" />}
                    {n.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular">{whenFmt.format(new Date(n.created_at))}</span>
                </span>
                {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
              </>
            );
            return (
              <li key={n.id}>
                {href ? (
                  <Link href={href} className="block rounded-md border border-line bg-surface p-3">
                    {inner}
                  </Link>
                ) : (
                  <div className="rounded-md border border-line bg-surface p-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
