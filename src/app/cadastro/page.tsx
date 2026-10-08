import type { Metadata } from "next";
import Link from "next/link";
import { AppBar } from "@/components/layout/app-bar";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta · Bate Carta" };

export default function CadastroPage() {
  return (
    <>
      <AppBar back="/" title="Criar conta" />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 pb-10">
        <SignupForm />
        <p className="text-center text-sm text-muted">
          Já tem conta?{" "}
          <Link href="/entrar" className="font-bold text-accent-text">
            Entrar
          </Link>
        </p>
      </main>
    </>
  );
}
