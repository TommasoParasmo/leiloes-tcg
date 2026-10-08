"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { createClient } from "@/lib/supabase/client";

/** Exclusão da conta pelo próprio comprador (LGPD), com confirmação. */
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const sb = createClient();
    const { data, error: rpcError } = await sb.rpc("delete_my_account");
    const result = data as AuctionResult | null;
    if (rpcError || !result?.ok) {
      setPending(false);
      return setError(result ? auctionMessage(result) : "Não foi possível excluir agora. Tente novamente.");
    }
    // as sessões já foram encerradas no servidor; limpa a deste aparelho
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 w-full items-center justify-center rounded-md font-bold text-danger">
        Excluir minha conta
      </button>
      {open && (
        <Sheet
          title="Excluir conta"
          onClose={() => {
            if (!pending) setOpen(false);
          }}
        >
          <p className="text-sm text-muted">
            Seu nome, apelido, e-mail e endereço serão apagados e você sairá de todos os aparelhos. Não dá para desfazer. CPF, WhatsApp e pedidos pagos ficam
            guardados como explica a{" "}
            <a href="/privacidade" target="_blank" className="font-bold text-accent-text underline">
              política de privacidade
            </a>
            .
          </p>
          {error && (
            <p role="alert" className="rounded-md bg-danger/10 p-3 text-sm font-semibold text-danger">
              {error}
            </p>
          )}
          <Button variant="danger" block pending={pending} onClick={confirm}>
            Excluir definitivamente
          </Button>
          <Button variant="secondary" block disabled={pending} onClick={() => setOpen(false)}>
            Manter conta
          </Button>
        </Sheet>
      )}
    </>
  );
}
