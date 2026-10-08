import type { Metadata } from "next";
import { AppBar } from "@/components/layout/app-bar";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recuperar senha · Bate Carta" };

export default function RecuperarSenhaPage() {
  return (
    <>
      <AppBar back="/entrar" title="Recuperar senha" />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
        <RecoverForm />
      </main>
    </>
  );
}
