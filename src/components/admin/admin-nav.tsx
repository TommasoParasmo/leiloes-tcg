import Link from "next/link";
import { cn } from "@/lib/cn";

export type AdminTab = "eventos" | "cartas" | "pedidos" | "clientes" | "whatsapp";

const tabs: { id: AdminTab; href: string; label: string }[] = [
  { id: "eventos", href: "/painel", label: "Eventos" },
  { id: "cartas", href: "/painel/cartas", label: "Cartas" },
  { id: "pedidos", href: "/painel/pedidos", label: "Pedidos" },
  { id: "clientes", href: "/painel/clientes", label: "Clientes" },
  { id: "whatsapp", href: "/painel/whatsapp", label: "WhatsApp" },
];

/** Abas do painel do leiloeiro (no lugar da TabBar do comprador). */
export function AdminNav({ active }: { active: AdminTab }) {
  return (
    <nav aria-label="Painel do leiloeiro" className="mx-auto w-full max-w-md px-4">
      <ul className="grid grid-cols-5 gap-0.5 rounded-md bg-surface p-1">
        {tabs.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-sm text-[12.5px] font-bold",
                t.id === active ? "bg-surface-2 text-text" : "text-muted",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Atalho no topo do painel para os dados da loja (Pix e CEP de envio). */
export function StoreLink() {
  return (
    <Link href="/painel/loja" className="flex min-h-12 items-center">
      <span className="rounded-pill bg-surface-2 px-3 py-1.5 text-xs font-bold">Minha loja</span>
    </Link>
  );
}
