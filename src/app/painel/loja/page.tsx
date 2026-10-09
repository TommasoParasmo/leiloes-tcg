import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { SenderForm } from "./sender-form";
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

type Private = {
  origin_cep: string | null;
  whatsapp_group_url: string | null;
  sender_name: string | null;
  sender_street: string | null;
  sender_number: string | null;
  sender_complement: string | null;
  sender_district: string | null;
  sender_city: string | null;
  sender_state: string | null;
};

async function Loja() {
  const { sb, sellerId, sellerName } = await requireAdmin("/painel/loja");
  const [{ data: seller }, { data: priv }] = await Promise.all([
    sb.from("sellers").select("pix_key, pix_receiver_name, pix_receiver_city").eq("id", sellerId).maybeSingle<{
      pix_key: string | null;
      pix_receiver_name: string | null;
      pix_receiver_city: string | null;
    }>(),
    sb
      .from("seller_private")
      .select("origin_cep, whatsapp_group_url, sender_name, sender_street, sender_number, sender_complement, sender_district, sender_city, sender_state")
      .eq("seller_id", sellerId)
      .maybeSingle<Private>(),
  ]);
  return (
    <StoreForm
      storeName={sellerName}
      initial={{
        pixKey: seller?.pix_key ?? "",
        pixName: seller?.pix_receiver_name ?? "",
        pixCity: seller?.pix_receiver_city ?? "",
        originCep: priv?.origin_cep ? `${priv.origin_cep.slice(0, 5)}-${priv.origin_cep.slice(5)}` : "",
        groupUrl: priv?.whatsapp_group_url ?? "",
      }}
    >
      <SenderForm
        originCep={priv?.origin_cep ?? ""}
        initial={{
          name: priv?.sender_name ?? "",
          street: priv?.sender_street ?? "",
          number: priv?.sender_number ?? "",
          complement: priv?.sender_complement ?? "",
          district: priv?.sender_district ?? "",
          city: priv?.sender_city ?? "",
          state: priv?.sender_state ?? "",
        }}
      />
    </StoreForm>
  );
}
