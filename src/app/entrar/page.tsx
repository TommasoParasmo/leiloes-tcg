import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar · Bate Carta" };

type Search = Promise<{ next?: string; confirmado?: string; erro?: string }>;

export default function EntrarPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppBar back="/" title="Entrar" />
      <Suspense>
        <Entrar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Entrar({ searchParams }: { searchParams: Search }) {
  const { next, confirmado, erro } = await searchParams;
  return (
    <>
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
        {erro === "link" && <p className="rounded-sm bg-danger/15 px-3 py-2 text-sm font-semibold text-danger">O link expirou ou já foi usado. Tente entrar ou peça um novo.</p>}
        {confirmado && <p className="rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win">E-mail confirmado. Agora é só entrar.</p>}
        <LoginForm next={safeNext(next)} />
        <p className="text-center text-sm text-muted">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-bold text-accent-text">
            Criar conta
          </Link>
        </p>
      </main>
    </>
  );
}

/** Só redireciona para caminhos internos (evita redirecionamento aberto). */
function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
