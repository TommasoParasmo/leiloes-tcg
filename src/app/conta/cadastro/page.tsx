import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { CpfForm } from "./cpf-form";

export const metadata: Metadata = { title: "Completar cadastro · Bate Carta" };

export default function CadastroPage({ searchParams }: PageProps<"/conta/cadastro">) {
  return (
    <>
      <AppBar back="/conta" title="Completar cadastro" />
      <Suspense fallback={<PageLoading />}>
        <Cadastro searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Cadastro({ searchParams }: { searchParams: PageProps<"/conta/cadastro">["searchParams"] }) {
  const { next } = await searchParams;
  const nextPath = safeNext(typeof next === "string" ? next : undefined, "/conta");
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect(`/entrar?next=${encodeURIComponent(`/conta/cadastro?next=${nextPath}`)}`);
  const { data: profile } = await sb.from("profiles").select("cpf").eq("id", data.user.id).maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-10 pt-2">
      {profile?.cpf ? (
        <section className="rounded-md border border-line bg-surface p-4 text-center">
          <p className="font-bold">Cadastro completo</p>
          <p className="mt-1 text-sm text-muted">Você já pode dar lances.</p>
          <Link href={nextPath} className="mt-3 flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
            Voltar
          </Link>
        </section>
      ) : (
        <>
          <p className="text-sm text-muted">Falta só o CPF para liberar seus lances.</p>
          <CpfForm next={nextPath} />
        </>
      )}
    </main>
  );
}
