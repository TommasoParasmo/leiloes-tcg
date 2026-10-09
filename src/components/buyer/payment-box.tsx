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

/**
 * Pagar em dois toques: "Copiar código Pix" e, depois de pagar no banco, "Já paguei".
 * "Já paguei" só avisa o leiloeiro (pedido vai para conferência); quem confirma é ele.
 * Anexar o comprovante continua possível, mas é opcional.
 */
export function PaymentBox({ orderId, userId, totalCents, pix, proofSent }: { orderId: string; userId: string; totalCents: number; pix: Pix | null; proofSent: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState<"key" | "code" | null>(null);
  // depois de copiar o código, a tela vira "Código copiado!" com o "Já paguei"
  const [codeCopied, setCodeCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
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
      if (what === "code") setCodeCopied(true);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("Não foi possível copiar. Toque e segure o texto para copiar.");
    }
  }

  async function claimPaid() {
    setClaiming(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await createClient().rpc("submit_payment_proof", { p_order_id: orderId, p_proof_path: null });
      const result = data as AuctionResult | null;
      if (rpcErr || !result?.ok) setError(result ? auctionMessage(result) : "Não foi possível avisar. Tente de novo.");
      else router.refresh();
    } catch {
      setError("Sem conexão. Tente de novo.");
    }
    setClaiming(false);
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
      {!pix?.pix_key ? (
        <p className="text-sm text-muted">O leiloeiro ainda não cadastrou a chave Pix. Fale com ele pelo WhatsApp do grupo.</p>
      ) : codeCopied && !proofSent ? (
        <div className="flex flex-col gap-2 text-center">
          <p className="font-display text-xl font-bold text-win">Código copiado!</p>
          <p className="text-sm text-muted">Abra o app do seu banco, escolha Pix copia e cola e cole o código. Depois de pagar, volte aqui.</p>
          <Button block className="min-h-[60px] text-lg" pending={claiming} onClick={() => void claimPaid()}>
            Já paguei
          </Button>
          <button type="button" onClick={() => setCodeCopied(false)} className="min-h-11 text-sm font-bold text-muted">
            Copiar o código de novo
          </button>
        </div>
      ) : (
        <>
          {code && (
            <Button block className="min-h-[60px] text-lg" onClick={() => void copy("code", code)}>
              Copiar código Pix
            </Button>
          )}
          <div className="flex items-center gap-2 rounded-sm bg-surface-2 p-2 pl-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted">Ou use a chave Pix{pix.receiver_name ? ` · ${pix.receiver_name}` : ""}</span>
              <span className="block break-all font-bold">{pix.pix_key}</span>
            </span>
            <button type="button" className="min-h-11 shrink-0 px-2 font-bold text-accent-text" onClick={() => void copy("key", pix.pix_key!)}>
              {copied === "key" ? "Copiada" : "Copiar"}
            </button>
          </div>
        </>
      )}
      <p aria-live="polite" className="sr-only">
        {copied ? "Copiado" : ""}
      </p>
      <div className="border-t border-line pt-3">
        <p className="text-sm text-muted">{proofSent ? "Você avisou que pagou. O leiloeiro confere e confirma. Se quiser, mande o comprovante." : "Comprovante é opcional: ajuda o leiloeiro a achar seu Pix."}</p>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line text-sm font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
          {pending ? "Enviando…" : "Mandar foto do comprovante"}
          <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" disabled={pending} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </div>
      <FormError message={error} />
    </section>
  );
}
