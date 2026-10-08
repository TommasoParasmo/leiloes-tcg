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
      .select("user_id, status, profiles(id, nickname, full_name, whatsapp, status), wins(amount_cents, status)")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(1000),
    sb.from("penalties").select("id, user_id, reason, issued_at, profiles!penalties_user_id_fkey(id, nickname, full_name, whatsapp, status)").eq("seller_id", sellerId).is("removed_at", null),
  ]);

  type P = { id: string; nickname: string; full_name: string; whatsapp: string; status: string };
  const byId = new Map<string, Client>();
  const ensure = (p: P) => {
    if (!byId.has(p.id))
      byId.set(p.id, { id: p.id, nickname: p.nickname, fullName: p.full_name, whatsapp: p.whatsapp, blocked: p.status === "blocked", storedCards: 0, storedCents: 0, penalties: [] });
    return byId.get(p.id)!;
  };
  for (const l of (lots ?? []) as unknown as { status: string; profiles: P; wins: { amount_cents: number; status: string }[] }[]) {
    const c = ensure(l.profiles);
    // cartas guardadas = arremates em lote ainda aberto
    if (l.status === "open")
      for (const w of l.wins)
        if (w.status === "stored") {
          c.storedCards += 1;
          c.storedCents += Number(w.amount_cents);
        }
  }
  for (const p of (penalties ?? []) as unknown as { id: string; reason: string; issued_at: string; profiles: P }[]) {
    ensure(p.profiles).penalties.push({ id: p.id, reason: p.reason, issuedAt: p.issued_at });
  }
  const clients = [...byId.values()].sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.storedCents - a.storedCents || a.nickname.localeCompare(b.nickname));
  return <ClientsList clients={clients} />;
}
