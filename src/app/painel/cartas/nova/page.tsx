import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { PageLoading } from "@/components/ui/page-loading";
import { requireAdmin } from "@/lib/admin";
import { CardForm } from "./card-form";

export const metadata: Metadata = { title: "Cadastrar carta · Bate Carta" };

export default function NovaCartaPage() {
  return (
    <>
      <AppBar back="/painel/cartas" title="Cadastrar carta" />
      <Suspense fallback={<PageLoading />}>
        <Form />
      </Suspense>
    </>
  );
}

async function Form() {
  const { sellerId } = await requireAdmin("/painel/cartas/nova");
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
      <CardForm sellerId={sellerId} />
    </main>
  );
}
