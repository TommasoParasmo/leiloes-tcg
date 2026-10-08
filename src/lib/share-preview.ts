import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { formatBRL } from "@/lib/money";

/**
 * Prévia dos links no WhatsApp (OpenGraph): título, data e foto da carta.
 * O WhatsApp lê só o <head>, então tudo aqui é público e vem pronto do servidor.
 */

const whenFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type EventRow = {
  number: number;
  title: string;
  status: string;
  starts_at: string | null;
  rounds: { position: number; cards: { card_photos: { storage_path: string; position: number }[] } | null }[];
};

function photoUrl(sb: SupabaseClient, photos: { storage_path: string; position: number }[] | undefined) {
  const p = [...(photos ?? [])].sort((a, b) => a.position - b.position)[0];
  return p ? sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(p.storage_path).data.publicUrl : null;
}

function withImage(title: string, description: string, image: string | null): Metadata {
  const images = image ? [{ url: image, alt: title }] : undefined;
  return {
    title: `${title} · Bate Carta`,
    description,
    openGraph: { title, description, siteName: "Bate Carta", locale: "pt_BR", type: "website", ...(images ? { images } : {}) },
    twitter: { title, description, ...(images ? { images: images.map((i) => i.url) } : {}) },
  };
}

export async function eventPreview(sb: SupabaseClient, eventId: string): Promise<Metadata> {
  const { data } = await sb
    .from("events")
    .select("number, title, status, starts_at, rounds(position, cards(card_photos(storage_path, position)))")
    .eq("id", eventId)
    .maybeSingle<EventRow>();
  if (!data) return { title: "Sala ao vivo · Bate Carta" };
  const cards = data.rounds.length;
  const first = [...data.rounds].sort((a, b) => a.position - b.position)[0];
  const count = `${cards} ${cards === 1 ? "carta" : "cartas"}`;
  const description =
    data.status === "live"
      ? `Ao vivo agora · ${count}. Entre na sala e dê seu lance.`
      : data.status === "finished"
        ? `Evento encerrado · ${count}. Veja os resultados.`
        : data.starts_at
          ? `Começa ${whenFmt.format(new Date(data.starts_at)).replace(",", "")} · ${count}. Entre pelo link na hora do leilão.`
          : `${count}. Entre pelo link na hora do leilão.`;
  return withImage(`Leilão #${data.number} · ${data.title}`, description, photoUrl(sb, first?.cards?.card_photos));
}

type ResultRow = {
  status: string;
  current_amount_cents: number | null;
  leading_nickname: string | null;
  events: { number: number };
  cards: { name: string; variant: string | null; card_photos: { storage_path: string; position: number }[] };
};

export async function resultPreview(sb: SupabaseClient, roundId: string): Promise<Metadata> {
  const { data } = await sb
    .from("rounds")
    .select("status, current_amount_cents, leading_nickname, events(number), cards(name, variant, card_photos(storage_path, position))")
    .eq("id", roundId)
    .maybeSingle<ResultRow>();
  if (!data) return { title: "Resultado · Bate Carta" };
  const card = data.cards.variant ? `${data.cards.name} — ${data.cards.variant}` : data.cards.name;
  const sold = data.status === "closed" && data.leading_nickname && data.current_amount_cents != null;
  const title = sold ? `${card} arrematada por ${formatBRL(data.current_amount_cents!)}` : card;
  const description = sold
    ? `Vencedor: ${data.leading_nickname} · Leilão #${data.events.number}. Resultado confirmado pelo servidor.`
    : data.status === "closed"
      ? `Sem lances no Leilão #${data.events.number}. A carta volta em um próximo leilão.`
      : `Leilão #${data.events.number}.`;
  return withImage(title, description, photoUrl(sb, data.cards.card_photos));
}
