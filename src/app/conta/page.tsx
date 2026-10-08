import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui/page-loading";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/layout/app-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { AccumulationCard } from "@/components/accumulation-card";
import { Pill } from "@/components/ui/pill";
import { myLots } from "@/lib/buyer";
import { createClient } from "@/lib/supabase/server";
import { formatWhatsapp, formatCep } from "@/lib/validation";

export const metadata: Metadata = { title: "Conta · Bate Carta" };

export default function ContaPage() {
  return (
    <>
      <AppBar />
      <Suspense fallback={<PageLoading />}>
        <Conta />
      </Suspense>
      <TabBar active="conta" />
    </>
  );
}

async function Conta() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/entrar?next=/conta");
  const uid = data.user.id;

  const [{ data: profile }, { data: address }, { data: penalties }, lots] = await Promise.all([
    sb.from("profiles").select("full_name, nickname, whatsapp, status, role").eq("id", uid).maybeSingle(),
    sb.from("addresses").select("cep, street, number, complement, district, city, state").eq("user_id", uid).eq("is_default", true).maybeSingle(),
    sb.from("penalties").select("id, reason, issued_at").eq("user_id", uid).is("removed_at", null),
    myLots(sb),
  ]);
  const openLot = lots.find((l) => l.status === "open");
  const cards = penalties?.length ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-28">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold">{profile?.nickname ?? "Conta"}</h1>
          {profile?.status === "blocked" ? <Pill tone="danger">Bloqueado</Pill> : <Pill tone="win">Habilitado</Pill>}
        </div>

        {openLot && <AccumulationCard lot={openLot} />}

        <section className="rounded-md border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Advertências</h2>
            <span className="flex gap-1" aria-label={`${cards} de 2 cartões amarelos`}>
              {[0, 1].map((i) => (
                <span key={i} className={i < cards ? "h-5 w-3.5 rounded-[3px] bg-warn" : "h-5 w-3.5 rounded-[3px] border border-dashed border-muted"} />
              ))}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            {cards === 0
              ? "Nenhum cartão amarelo. Pagamentos em dia mantêm sua conta liberada."
              : cards === 1
                ? "Você tem 1 cartão amarelo. Um segundo atraso bloqueia novos lances."
                : "Conta bloqueada para lances por 2 cartões amarelos. Fale com o leiloeiro após regularizar."}
          </p>
          {penalties?.map((p) => (
            <p key={p.id} className="mt-1 text-xs text-warn">
              {p.reason}
            </p>
          ))}
        </section>

        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-2 font-bold">Perfil</h2>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
            <dt className="text-muted">Nome</dt>
            <dd>{profile?.full_name}</dd>
            <dt className="text-muted">Apelido</dt>
            <dd>{profile?.nickname}</dd>
            <dt className="text-muted">WhatsApp</dt>
            <dd>{profile?.whatsapp ? formatWhatsapp(profile.whatsapp) : "—"}</dd>
            <dt className="text-muted">E-mail</dt>
            <dd className="truncate">{data.user.email}</dd>
          </dl>
        </section>

        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-2 font-bold">Endereço de entrega</h2>
          {address ? (
            <p className="text-muted">
              {address.street}, {address.number}
              {address.complement ? ` · ${address.complement}` : ""}
              <br />
              {address.district} · {address.city}/{address.state} · CEP {formatCep(address.cep)}
            </p>
          ) : (
            <p className="text-muted">Nenhum endereço cadastrado.</p>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <Link href="/nova-senha" className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
            Trocar senha
          </Link>
          <form action="/sair" method="post">
            <button type="submit" className="flex min-h-12 w-full items-center justify-center rounded-md border border-line font-bold text-muted">
              Sair
            </button>
          </form>
        </div>
      </main>
  );
}
