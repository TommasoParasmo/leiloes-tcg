import Link from "next/link";
import { cn } from "@/lib/cn";

export type Tab = "aovivo" | "eventos" | "arremates" | "conta";

// Traços simples 24×24 (stroke = currentColor), um por aba.
const icons: Record<Tab, React.ReactNode> = {
  aovivo: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </>
  ),
  eventos: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  arremates: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7" />
    </>
  ),
  conta: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
};

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
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  {icons[t.id]}
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
