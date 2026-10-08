import Link from "next/link";
import { cn } from "@/lib/cn";

/** Substitui os botões de lance para quem está bloqueado ou precisa fechar o lote. */
export function BlockedNotice({ reason }: { reason: "blocked" | "must_close_lot" | "profile_required" }) {
  const text = {
    blocked: {
      title: "Lances bloqueados",
      body: "Você recebeu 2 cartões amarelos por pagamentos em atraso. Regularize suas pendências para voltar a participar.",
      cta: "Ver pendências",
    },
    must_close_lot: {
      title: "Feche seu lote para participar",
      body: "Você já acumulou cartas por 2 leilões. Pague e peça o envio para voltar a dar lances.",
      cta: "Fechar lote",
    },
    profile_required: {
      title: "Complete seu cadastro",
      body: "Precisamos do seu apelido, WhatsApp e endereço antes do primeiro lance.",
      cta: "Completar cadastro",
    },
  }[reason];
  return (
    <section className="rounded-md border border-danger/50 bg-danger/10 p-4">
      <div className="flex items-center gap-2">
        {reason === "blocked" && (
          <span aria-label="2 cartões amarelos" className="flex gap-1">
            <span className="h-5 w-3.5 rounded-[3px] bg-warn" />
            <span className="h-5 w-3.5 rounded-[3px] bg-warn" />
          </span>
        )}
        <p className="font-bold text-danger">{text.title}</p>
      </div>
      <p className="mt-2 text-sm text-muted">{text.body}</p>
      <Link href="/conta" className="mt-3 inline-flex min-h-12 items-center rounded-md bg-surface-2 px-4 font-bold">
        {text.cta}
      </Link>
    </section>
  );
}

/** Faixa fina no topo enquanto a conexão em tempo real volta (design §7). */
export function ReconnectBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <div role="status" className="bg-warn/15 px-4 py-1.5 text-center text-xs font-bold text-warn">Reconectando…</div>;
}

/** Aviso do topo: lance superado ou erro do servidor. */
export function RoomToast({ tone, text, detail }: { tone: "live" | "danger" | "neutral"; text: string; detail?: string }) {
  return (
    <div
      role={tone === "live" ? "alert" : "status"}
      aria-live={tone === "live" ? "assertive" : "polite"}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-bold",
        tone === "live" && "bg-live text-white",
        tone === "danger" && "bg-danger/15 text-danger",
        tone === "neutral" && "bg-surface-2 text-text",
      )}
    >
      <span>{text}</span>
      {detail && <span className="text-xs font-semibold opacity-90 tabular">{detail}</span>}
    </div>
  );
}
