import type { Metadata } from "next";
import { AppBar } from "@/components/layout/app-bar";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Nova senha · Bate Carta" };

export default function NovaSenhaPage() {
  return (
    <>
      <AppBar back="/" title="Nova senha" />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
        <NewPasswordForm />
      </main>
    </>
  );
}
