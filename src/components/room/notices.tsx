import Link from "next/link";
import { cn } from "@/lib/cn";

/** Substitui os botões de lance para quem está bloqueado ou precisa fechar o lote. */
export function BlockedNotice({ reason, returnTo }: { reason: "blocked" | "must_close_lot" | "profile_required" | "cpf_required"; returnTo?: string }) {
  const back = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
  const text = {
    blocked: {
      title: "Lances bloqueados",
      body: "Você recebeu 2 cartões amarelos por pagamentos em atraso. Regularize suas pendências para voltar a participar.",
      cta: "Ver pendências",
      href: "/conta/pedidos",
    },
    must_close_lot: {
      title: "Feche seu lote para participar",
      body: "Você já acumulou cartas por 2 leilões. Feche o lote (pagamento e envio) para voltar a dar lances.",
      cta: "Fechar lote",
      href: "/conta/lote",
    },
    profile_required: {
      title: "Complete seu cadastro",
      body: "Precisamos do seu apelido, WhatsApp e endereço antes do primeiro lance.",
      cta: "Completar cadastro",
      href: `/conta/cadastro${back}`,
    },
    cpf_required: {
      title: "Falta seu CPF",
      body: "Para dar lances, informe seu CPF uma vez. Ele identifica você no pedido e no envio.",
      cta: "Completar cadastro",
      href: `/conta/cadastro${back}`,
    },
  }[reason];
  return (
    <section className="rounded-md border border-danger/50 bg-danger/10 p-4">
      <div className="flex items-center gap-2">
        {reason === "blocked" && (
          <span role="img" aria-label="2 cartões amarelos" className="flex gap-1">
            <span aria-hidden className="h-5 w-3.5 rounded-[3px] bg-warn" />
            <span aria-hidden className="h-5 w-3.5 rounded-[3px] bg-warn" />
          </span>
        )}
        <p className="font-bold text-danger">{text.title}</p>
      </div>
      <p className="mt-2 text-sm text-muted">{text.body}</p>
      <Link href={text.href} className="mt-3 inline-flex min-h-12 items-center rounded-md bg-surface-2 px-4 font-bold">
        {text.cta}
      </Link>
    </section>
  );
}

/** Faixa fina no topo enquanto a conexão em tempo real volta (design §7). */
export function ReconnectBanner({ show }: { show: boolean }) {
  if (!show) return null;
  // Sobreposto, para não empurrar os botões de lance enquanto o usuário toca.
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-40 bg-[color-mix(in_srgb,var(--color-warn)_18%,var(--color-bg))] px-4 pb-1.5 pt-[calc(env(safe-area-inset-top)+6px)] text-center text-xs font-bold text-warn">
      Reconectando…
    </div>
  );
}

/**
 * Aviso do topo: lance superado ou erro do servidor. Fica sobreposto (não desloca os
 * botões) e é só visual: o anúncio para leitores de tela sai pela região viva da sala.
 */
export function RoomToast({ tone, text, detail }: { tone: "live" | "danger" | "neutral"; text: string; detail?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-x-4 top-[calc(env(safe-area-inset-top)+12px)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-bold shadow-lg",
        tone === "live" && "bg-live text-bg",
        tone === "danger" && "bg-[color-mix(in_srgb,var(--color-danger)_18%,var(--color-bg))] text-danger",
        tone === "neutral" && "bg-surface-2 text-text",
      )}
    >
      <span>{text}</span>
      {detail && <span className="text-xs font-semibold opacity-90 tabular">{detail}</span>}
    </div>
  );
}
