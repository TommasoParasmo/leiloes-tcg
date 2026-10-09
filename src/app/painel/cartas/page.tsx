import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav, StoreLink } from "@/components/admin/admin-nav";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = { title: "Cartas · Painel · Bate Carta" };

export default function CartasPage() {
  return (
    <>
      <AppBar right={<StoreLink />} />
      <AdminNav active="cartas" />
      <Suspense fallback={<PageLoading />}>
        <Cartas />
      </Suspense>
    </>
  );
}

interface Row {
  id: string;
  name: string;
  tcg: string;
  variant: string | null;
  card_number: string | null;
  liga_price_cents: number | null;
  card_photos: { storage_path: string; position: number }[];
  rounds: { status: string }[];
}

async function Cartas() {
  const { sb, sellerId } = await requireAdmin("/painel/cartas");
  const { data } = await sb
    .from("cards")
    .select("id, name, tcg, variant, card_number, liga_price_cents, card_photos(storage_path, position), rounds(status)")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(200);
  const cards = (data ?? []) as unknown as Row[];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">Cartas</h1>
        <Link href="/painel/cartas/nova" className="flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-bold text-on-accent">
          Cadastrar carta
        </Link>
      </div>
      {cards.length ? (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => {
            const photo = [...c.card_photos].sort((a, b) => a.position - b.position)[0];
            const url = photo ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl : null;
            const sold = c.rounds.some((r) => r.status === "closed");
            const queued = c.rounds.some((r) => r.status === "queued" || r.status === "open" || r.status === "paused");
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-2.5">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" loading="lazy" width={44} height={60} className="h-[60px] w-11 rounded-[5px] object-cover" />
                ) : (
                  <span aria-hidden className="h-[60px] w-11 rounded-[5px] bg-surface-2" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{c.name}</p>
                  <p className="truncate text-xs text-muted">{[c.tcg, c.variant, c.card_number].filter(Boolean).join(" · ")}</p>
                  {c.liga_price_cents != null && <p className="text-xs text-muted tabular">Liga {formatBRL(c.liga_price_cents)}</p>}
                </div>
                <span className="text-xs font-bold text-muted">{sold ? "Vendida" : queued ? "Em evento" : "Livre"}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="rounded-md border border-line bg-surface p-5 text-center">
          <p className="font-bold">Nenhuma carta cadastrada</p>
          <p className="mt-1 text-sm text-muted">Cadastre com foto: é ela que aparece na sala e na mensagem do grupo.</p>
        </section>
      )}
    </main>
  );
}
