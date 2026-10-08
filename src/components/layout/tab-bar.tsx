import Link from "next/link";
import { cn } from "@/lib/cn";

export type Tab = "aovivo" | "eventos" | "arremates" | "conta";

const tabs: { id: Tab; href: string; label: string }[] = [
  { id: "aovivo", href: "/", label: "Ao vivo" },
  { id: "eventos", href: "/eventos", label: "Eventos" },
  { id: "arremates", href: "/arremates", label: "Arremates" },
  { id: "conta", href: "/conta", label: "Conta" },
];

/** Navegação do comprador, fixa embaixo (design §5 TabBar). */
export function TabBar({ active }: { active: Tab }) {
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-bold", on ? "text-accent-text" : "text-muted")}
              >
                <span aria-hidden className={cn("size-4 rounded-[5px]", on ? "bg-accent" : "bg-surface-2")} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
