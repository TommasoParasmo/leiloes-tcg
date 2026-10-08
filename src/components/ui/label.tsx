import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Rótulo "k" do design: 11–12 px, caixa alta, peso 800, muted. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-extrabold uppercase tracking-[.06em] text-muted", className)}>{children}</p>;
}
