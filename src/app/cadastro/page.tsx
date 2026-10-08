import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta · Bate Carta" };

type Search = Promise<{ next?: string }>;

export default function CadastroPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppBar back="/" title="Criar conta" />
      <Suspense>
        <Cadastro searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Cadastro({ searchParams }: { searchParams: Search }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 pb-10">
      <SignupForm next={target} />
      <p className="text-center text-sm text-muted">
        Já tem conta?{" "}
        <Link href={target === "/" ? "/entrar" : `/entrar?next=${encodeURIComponent(target)}`} className="font-bold text-accent-text">
          Entrar
        </Link>
      </p>
    </main>
  );
}
