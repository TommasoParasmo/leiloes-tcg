import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PillTone = "live" | "win" | "warn" | "danger" | "acc" | "neutral";

const tones: Record<PillTone, string> = {
  live: "bg-live/15 text-live",
  win: "bg-win/15 text-win",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  acc: "bg-accent/20 text-accent-text",
  neutral: "bg-surface-2 text-muted",
};

export function Pill({ tone = "neutral", dot, children, className }: { tone?: PillTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-extrabold", tones[tone], className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
