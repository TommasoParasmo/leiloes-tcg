import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav, StoreLink } from "@/components/admin/admin-nav";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { eventDay } from "@/lib/events";
import { formatBRL } from "@/lib/money";
import { hubEventCta, type HubEvent } from "@/lib/painel";

export const metadata: Metadata = { title: "Painel · Bate Carta" };

export default function PainelPage() {
  return (
    <>
      <AppBar right={<StoreLink />} />
      <AdminNav active="inicio" />
      <Suspense fallback={<PageLoading rows={4} />}>
        <Inicio />
      </Suspense>
    </>
  );
}

/** Início do leiloeiro: quatro botões grandes, um para cada coisa do dia a dia. */
async function Inicio() {
  const { sb, userId, sellerId } = await requireAdmin("/painel");
  const [{ data: me }, { data: events }, { data: owing }] = await Promise.all([
    sb.from("profiles").select("nickname").eq("id", userId).maybeSingle<{ nickname: string }>(),
    sb
      .from("events")
      .select("id, number, status, starts_at, rounds(id)")
      .eq("seller_id", sellerId)
      .in("status", ["live", "scheduled", "draft"])
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(20),
    sb.from("orders").select("user_id, total_cents").eq("seller_id", sellerId).in("status", ["awaiting_payment", "proof_sent"]),
  ]);

  const list = ((events ?? []) as { id: string; number: number; status: HubEvent["status"]; starts_at: string | null; rounds: { id: string }[] }[]).map((e) => ({
    id: e.id,
    number: e.number,
    status: e.status,
    startsAt: e.starts_at,
    cards: e.rounds.length,
  }));
  const cta = hubEventCta(list, new Date());
  const debts = (owing ?? []) as { user_id: string; total_cents: number }[];
  const people = new Set(debts.map((d) => d.user_id)).size;
  const owed = debts.reduce((acc, d) => acc + Number(d.total_cents), 0);

  const when = (iso: string | null) => {
    const d = eventDay(iso);
    return d ? `${d.day}/${d.month} às ${d.time}` : "sem horário";
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-4">
      <h1 className="font-display text-[22px] font-bold">Oi{me?.nickname ? `, ${me.nickname}` : ""}. O que vamos fazer?</h1>

      <HubButton
        href={cta.event ? `/painel/eventos/${cta.event.id}` : "/painel/eventos/novo"}
        icon="▶"
        primary={!!cta.event}
        title={cta.kind === "live" ? "Voltar ao leilão ao vivo" : cta.kind === "today" ? "Começar o leilão de hoje" : cta.kind === "next" ? "Abrir o próximo leilão" : "Nenhum leilão marcado"}
        hint={
          cta.event
            ? `Leilão ${cta.event.number}${cta.kind === "live" ? " está ao vivo" : `, ${when(cta.event.startsAt)}`} · ${cta.event.cards} ${cta.event.cards === 1 ? "carta" : "cartas"}`
            : "Toque para criar um"
        }
      />
      <HubButton href="/painel/cartas/nova" icon="📷" title="Cadastrar cartas" hint="Tire a foto e escreva o nome" />
      <HubButton href="/painel/eventos/novo" icon="🗓" title="Criar leilão" hint="Escolha o dia e as cartas" />
      <HubButton
        href="/painel/cobranca"
        icon="💰"
        title="Quem me deve"
        hint={people ? `${people} ${people === 1 ? "pessoa" : "pessoas"}, ${formatBRL(owed)} no total` : "Ninguém deve agora"}
      />

      <nav aria-label="Mais opções" className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
        <Link href="/painel/whatsapp" className="flex min-h-11 items-center justify-center rounded-md bg-surface">
          Mensagens do grupo
        </Link>
        <Link href="/painel/loja" className="flex min-h-11 items-center justify-center rounded-md bg-surface">
          Minha loja
        </Link>
      </nav>
    </main>
  );
}

function HubButton({ href, icon, title, hint, primary }: { href: string; icon: string; title: string; hint: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "grid min-h-[84px] grid-cols-[48px_1fr] items-center gap-3.5 rounded-lg border p-4",
        primary ? "border-accent bg-accent text-on-accent" : "border-line bg-surface",
      )}
    >
      <span aria-hidden className={cn("grid size-12 place-items-center rounded-[14px] text-2xl", primary ? "bg-white/20" : "bg-surface-2")}>
        {icon}
      </span>
      <span>
        <span className="block font-display text-lg font-bold leading-tight">{title}</span>
        <span className={cn("text-[13px]", primary ? "text-on-accent/85" : "text-muted")}>{hint}</span>
      </span>
    </Link>
  );
}
