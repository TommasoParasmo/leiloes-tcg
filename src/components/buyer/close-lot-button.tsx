"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { formatBRL } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

/** Fecha o lote (confirmação em painel): vira pedido e o leiloeiro calcula o frete. */
export function CloseLotButton({ lotId, totalCents, cards, label = "Fechar lote" }: { lotId: string; totalCents: number; cards: number; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc("close_my_lot", { p_lot_id: lotId });
    const result = data as (AuctionResult & { order_id?: string }) | null;
    if (rpcError || !result?.ok) {
      setPending(false);
      return setError(result ? auctionMessage(result) : "Sem conexão. Nada foi alterado, tente de novo.");
    }
    router.replace(result.order_id ? `/conta/pedidos/${result.order_id}` : "/conta/pedidos");
    router.refresh();
  }

  return (
    <>
      <Button block className="min-h-[60px] text-lg" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Sheet title="Pagar estas cartas?" onClose={() => !pending && setOpen(false)}>
          <p className="text-sm text-muted">
            {cards} {cards === 1 ? "carta" : "cartas"} · {formatBRL(totalCents)}. O leiloeiro calcula o frete e o código Pix aparece aqui, com o total. Cartas que você
            ganhar depois ficam para o próximo pagamento.
          </p>
          <FormError message={error} />
          <Button block className="min-h-[52px]" pending={pending} onClick={() => void confirm()}>
            Pedir o frete e pagar
          </Button>
          <Button block variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Agora não
          </Button>
        </Sheet>
      )}
    </>
  );
}
