"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { shrinkPhoto } from "@/lib/image";
import { formatBRL } from "@/lib/money";
import { PROOFS_BUCKET } from "@/lib/orders";
import { pixCopyPaste } from "@/lib/pix";
import { createClient } from "@/lib/supabase/client";

type Pix = { pix_key: string | null; receiver_name: string | null; receiver_city: string | null };

/** Pix (chave e copia e cola com o valor) e envio do comprovante. */
export function PaymentBox({ orderId, userId, totalCents, pix, proofSent }: { orderId: string; userId: string; totalCents: number; pix: Pix | null; proofSent: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState<"key" | "code" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const code =
    pix?.pix_key && totalCents > 0
      ? pixCopyPaste({ key: pix.pix_key, name: pix.receiver_name ?? "Bate Carta", city: pix.receiver_city ?? "Brasil", amountCents: totalCents, txid: orderId.slice(0, 8) })
      : null;

  async function copy(what: "key" | "code", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("Não foi possível copiar. Toque e segure o texto para copiar.");
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return setError("Envie uma foto ou PDF do comprovante.");
    setPending(true);
    setError(null);
    const sb = createClient();
    try {
      const isPdf = file.type === "application/pdf";
      const body = isPdf ? file : await shrinkPhoto(file);
      const path = `${userId}/${orderId}/${crypto.randomUUID().slice(0, 8)}.${isPdf ? "pdf" : "jpg"}`;
      const { error: upErr } = await sb.storage.from(PROOFS_BUCKET).upload(path, body, { contentType: isPdf ? "application/pdf" : "image/jpeg" });
      if (upErr) throw upErr;
      const { data, error: rpcErr } = await sb.rpc("submit_payment_proof", { p_order_id: orderId, p_proof_path: path });
      const result = data as AuctionResult | null;
      if (rpcErr || !result?.ok) {
        await sb.storage.from(PROOFS_BUCKET).remove([path]);
        setError(result ? auctionMessage(result) : "Não foi possível enviar. Tente de novo.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Não foi possível enviar o comprovante. Confira a conexão e tente de novo.");
    }
    setPending(false);
    if (input.current) input.current.value = "";
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-accent/50 bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">Pagar com Pix</h2>
        <span className="font-display text-xl font-bold tabular">{formatBRL(totalCents)}</span>
      </div>
      {pix?.pix_key ? (
        <>
          {code && (
            <Button block className="min-h-[52px]" onClick={() => void copy("code", code)}>
              {copied === "code" ? "Código copiado" : "Copiar Pix copia e cola"}
            </Button>
          )}
          <div className="flex items-center gap-2 rounded-sm bg-surface-2 p-2 pl-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted">Chave Pix{pix.receiver_name ? ` · ${pix.receiver_name}` : ""}</span>
              <span className="block break-all font-bold">{pix.pix_key}</span>
            </span>
            <button type="button" className="min-h-11 shrink-0 px-2 font-bold text-accent-text" onClick={() => void copy("key", pix.pix_key!)}>
              {copied === "key" ? "Copiada" : "Copiar"}
            </button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? "Copiado" : ""}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">O leiloeiro ainda não cadastrou a chave Pix. Fale com ele pelo WhatsApp do grupo.</p>
      )}
      <div className="border-t border-line pt-3">
        <p className="text-sm text-muted">{proofSent ? "Comprovante enviado. Quer trocar? Envie outro." : "Depois de pagar, envie o comprovante para o leiloeiro confirmar."}</p>
        <label className="mt-2 flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-line font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
          {pending ? "Enviando…" : proofSent ? "Enviar outro comprovante" : "Enviar comprovante"}
          <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" disabled={pending} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </div>
      <FormError message={error} />
    </section>
  );
}
