import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ClientsList, type Client } from "@/components/admin/clients-list";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Clientes · Painel · Bate Carta" };

export default function ClientesPage() {
  return (
    <>
      <AppBar right={<span className="text-xs font-bold text-muted">Leiloeiro</span>} />
      <AdminNav active="clientes" />
      <Suspense fallback={<PageLoading />}>
        <Clientes />
      </Suspense>
    </>
  );
}

async function Clientes() {
  const { sb, sellerId } = await requireAdmin("/painel/clientes");
  const [{ data: lots }, { data: penalties }] = await Promise.all([
    sb
      .from("lots")
      .select("id, user_id, status, profiles(id, nickname, full_name, whatsapp, status), wins(amount_cents, status, won_at, events(number), cards(name, variant))")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(1000),
    sb.from("penalties").select("id, user_id, reason, issued_at, profiles!penalties_user_id_fkey(id, nickname, full_name, whatsapp, status)").eq("seller_id", sellerId).is("removed_at", null),
  ]);

  type P = { id: string; nickname: string; full_name: string; whatsapp: string; status: string };
  const byId = new Map<string, Client>();
  const ensure = (p: P) => {
    if (!byId.has(p.id))
      byId.set(p.id, {
        id: p.id,
        nickname: p.nickname,
        fullName: p.full_name,
        whatsapp: p.whatsapp,
        blocked: p.status === "blocked",
        openLotId: null,
        storedCards: 0,
        storedCents: 0,
        stored: [],
        penalties: [],
      });
    return byId.get(p.id)!;
  };
  type W = { amount_cents: number; status: string; won_at: string; events: { number: number }; cards: { name: string; variant: string | null } };
  for (const l of (lots ?? []) as unknown as { id: string; status: string; profiles: P; wins: W[] }[]) {
    const c = ensure(l.profiles);
    // cartas guardadas = arremates em lote ainda aberto
    if (l.status === "open") {
      c.openLotId = l.id;
      for (const w of [...l.wins].sort((a, b) => a.won_at.localeCompare(b.won_at)))
        if (w.status === "stored") {
          c.storedCards += 1;
          c.storedCents += Number(w.amount_cents);
          c.stored.push({ name: w.cards.variant ? `${w.cards.name} (${w.cards.variant})` : w.cards.name, eventNumber: w.events.number, amountCents: Number(w.amount_cents) });
        }
    }
  }
  for (const p of (penalties ?? []) as unknown as { id: string; reason: string; issued_at: string; profiles: P }[]) {
    ensure(p.profiles).penalties.push({ id: p.id, reason: p.reason, issuedAt: p.issued_at });
  }
  const clients = [...byId.values()].sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.storedCents - a.storedCents || a.nickname.localeCompare(b.nickname));
  return <ClientsList clients={clients} />;
}
