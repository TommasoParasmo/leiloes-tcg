"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { auctionMessage, type AuctionResult } from "@/lib/auction/codes";
import { createClient } from "@/lib/supabase/client";

/** Título e horário; o evento nasce como rascunho e as cartas entram na tela seguinte. */
export function EventForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("20:00");
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError("Dê um nome ao evento");
    setPending(true);
    setError(null);
    // data e hora vêm no fuso do aparelho; new Date() converte para UTC
    const iso = date ? new Date(`${date}T${time || "00:00"}`).toISOString() : null;
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
      <div className="grid grid-cols-2 gap-2">
        <Field label="Data" name="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Início" name="event-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <p className="-mt-1.5 text-xs text-muted">Opcional. Aparece em “Próximos eventos” e no link de divulgação.</p>
      <FormError message={error} />
      <Button type="submit" block pending={pending}>
        Criar rascunho e adicionar cartas
      </Button>
    </form>
  );
}
