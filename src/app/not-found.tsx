import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo />
      <h1 className="font-display text-xl font-bold">Página não encontrada</h1>
      <p className="text-sm text-muted">O link pode estar errado ou o leilão já foi removido.</p>
      <Link href="/" className="flex min-h-12 items-center justify-center rounded-md bg-accent font-bold text-on-accent">
        Ver leilões
      </Link>
    </main>
  );
}
