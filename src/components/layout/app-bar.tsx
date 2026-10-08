import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

/** Barra do topo: logo (ou "‹ Título" em telas internas) e um elemento à direita. */
export function AppBar({ back, title, right }: { back?: string; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 bg-bg/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
      {back ? (
        <Link href={back} className="flex min-h-12 items-center gap-1 text-lg font-bold">
          <span aria-hidden>‹</span> {title}
        </Link>
      ) : (
        <Logo />
      )}
      {right}
    </header>
  );
}
