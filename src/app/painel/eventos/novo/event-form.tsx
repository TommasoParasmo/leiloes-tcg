"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { createClient } from "@/lib/supabase/client";

/** Título e horário; as cartas entram na tela do evento, logo depois. */
export function EventForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError("Dê um nome ao evento");
    setPending(true);
    setError(null);
    // datetime-local vem no horário do aparelho; new Date() converte para UTC
    const iso = startsAt ? new Date(startsAt).toISOString() : null;
    const { data, error: rpcError } = await createClient().rpc("admin_create_event", { p_title: title.trim(), p_starts_at: iso });
    const result = data as (AuctionResult & { id?: string }) | null;
    if (rpcError || !result?.ok || !result.id) {
      setPending(false);
      return setError(result ? auctionMessage(result) : "Não foi possível criar o evento. Tente de novo.");
    }
    router.replace(`/painel/eventos/${result.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field
        label="Nome do evento"
        name="event-title"
        placeholder="Noite das Holos"
        value={title}
        maxLength={120}
        autoComplete="off"
        onChange={(e) => {
          setTitle(e.target.value);
          setTitleError(null);
        }}
        error={titleError}
        hint="Aparece como “Leilão #16 · Noite das Holos”. O número é automático."
      />
      <Field
        label="Data e hora"
        name="event-start"
        type="datetime-local"
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
        hint="Opcional. Mostrado em “Próximos eventos” e no link de divulgação."
      />
      <FormError message={error} />
      <Button type="submit" block pending={pending}>
        Criar e adicionar cartas
      </Button>
    </form>
  );
}
