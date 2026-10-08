"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { adminRpc } from "@/lib/admin-data";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { auctionMessage } from "@/lib/auction/codes";
import { canOpenPhoto, shrinkPhoto, withTimeout } from "@/lib/image";

/**
 * Imagem de fundo do evento: aparece no "Ao vivo agora" da página inicial e na lista de eventos.
 * Sem imagem própria, usa a imagem padrão da marca.
 */
export function EventCover({ sb, eventId, sellerId, initialUrl }: { sb: SupabaseClient; eventId: string; sellerId: string; initialUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [pending, setPending] = useState<"upload" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(path: string | null): Promise<boolean> {
    const result = await adminRpc(sb, "admin_set_event_cover", { p_event_id: eventId, p_path: path });
    if (!result.ok) {
      setError(auctionMessage(result));
      return false;
    }
    // a imagem anterior não é mais usada por ninguém
    if (typeof result.previous === "string") void sb.storage.from(CARD_PHOTOS_BUCKET).remove([result.previous]);
    return true;
  }

  async function upload(file: File) {
    if (pending) return;
    setError(null);
    setSaved(null);
    if (!(await canOpenPhoto(file))) return setError("Não foi possível abrir essa foto. Tente uma JPG ou PNG.");
    setPending("upload");
    const path = `${sellerId}/eventos/${eventId}/capa-${crypto.randomUUID().slice(0, 8)}.jpg`;
    try {
      const blob = await withTimeout(shrinkPhoto(file, 1600), 30_000);
      const { error: upError } = await withTimeout(sb.storage.from(CARD_PHOTOS_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" }), 60_000);
      if (upError) throw upError;
      if (await save(path)) {
        setUrl(sb.storage.from(CARD_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl);
        setSaved("Imagem de fundo trocada.");
        router.refresh();
      } else {
        void sb.storage.from(CARD_PHOTOS_BUCKET).remove([path]);
      }
    } catch {
      setError("Não foi possível enviar a imagem. Confira a conexão e tente de novo.");
    }
    setPending(null);
  }

  async function reset() {
    if (pending) return;
    setError(null);
    setSaved(null);
    setPending("reset");
    try {
      if (await save(null)) {
        setUrl(null);
        setSaved("Voltou para a imagem padrão.");
        router.refresh();
      }
    } catch {
      setError("Sem conexão com o servidor. Tente de novo.");
    }
    setPending(null);
  }

  return (
    <section aria-labelledby="capa" className="flex flex-col gap-2">
      <h2 id="capa" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-muted">
        Imagem de fundo
      </h2>
      <div className="relative aspect-[16/9] overflow-hidden rounded-md border border-line bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url ?? "/brand/hero.jpg"} alt={url ? "Imagem de fundo do evento" : "Imagem padrão"} className="size-full object-cover" />
        {!url && <span className="absolute bottom-2 left-2 rounded-pill bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">Padrão</span>}
      </div>
      <p className="text-xs text-muted">Aparece em “Ao vivo agora” na página inicial e na lista de eventos. Use uma foto deitada.</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div className={url ? "grid grid-cols-2 gap-2" : "grid"}>
        <Button variant="secondary" pending={pending === "upload"} disabled={!!pending} onClick={() => input.current?.click()}>
          Trocar imagem
        </Button>
        {url && (
          <Button variant="secondary" pending={pending === "reset"} disabled={!!pending} onClick={() => void reset()}>
            Usar padrão
          </Button>
        )}
      </div>
      <FormError message={error} />
      {saved && (
        <p role="status" className="text-sm font-bold text-win">
          {saved}
        </p>
      )}
    </section>
  );
}
