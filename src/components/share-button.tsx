"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Compartilha o link do evento (menu nativo do celular; senão copia o link). */
export function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} · Bate Carta`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // usuário cancelou o compartilhamento
    }
  }
  return (
    <button type="button" onClick={share} className={cn("inline-flex min-h-10 items-center rounded-pill bg-surface-2 px-3 text-xs font-bold", className)}>
      {copied ? "Link copiado" : "Compartilhar"}
    </button>
  );
}
