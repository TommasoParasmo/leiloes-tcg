"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";

/** Falha inesperada ao carregar uma tela (ex.: banco fora do ar). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo />
      <h1 className="font-display text-xl font-bold">Não conseguimos carregar esta tela</h1>
      <p className="text-sm text-muted">Pode ser a sua conexão ou uma instabilidade nossa. Nenhum lance seu se perde por isso.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={reset}>Tentar de novo</Button>
        <Link href="/" className="flex min-h-12 items-center justify-center rounded-md bg-surface-2 font-bold">
          Ir para o início
        </Link>
      </div>
    </main>
  );
}
