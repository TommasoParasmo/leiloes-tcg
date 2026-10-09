import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { StoreForm } from "./store-form";

export const metadata: Metadata = { title: "Minha loja · Painel · Bate Carta" };

export default function LojaPage() {
  return (
    <>
      <AppBar back="/painel" title="Minha loja" />
      <Suspense fallback={<PageLoading rows={3} />}>
        <Loja />
      </Suspense>
    </>
  );
}

async function Loja() {
  const { sb, sellerId, sellerName } = await requireAdmin("/painel/loja");
  const [{ data: seller }, { data: priv }] = await Promise.all([
    sb.from("sellers").select("pix_key, pix_receiver_name, pix_receiver_city").eq("id", sellerId).maybeSingle<{
      pix_key: string | null;
      pix_receiver_name: string | null;
      pix_receiver_city: string | null;
    }>(),
    sb.from("seller_private").select("origin_cep").eq("seller_id", sellerId).maybeSingle<{ origin_cep: string | null }>(),
  ]);
  return (
    <StoreForm
      storeName={sellerName}
      initial={{
        pixKey: seller?.pix_key ?? "",
        pixName: seller?.pix_receiver_name ?? "",
        pixCity: seller?.pix_receiver_city ?? "",
        originCep: priv?.origin_cep ? `${priv.origin_cep.slice(0, 5)}-${priv.origin_cep.slice(5)}` : "",
      }}
    />
  );
}
