"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Select, TextArea } from "@/components/ui/select";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { shrinkPhoto } from "@/lib/image";
import { parseBRL } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

const MAX_PHOTOS = 4;
const TCGS = ["Pokémon", "One Piece", "Magic", "Lorcana", "Yu-Gi-Oh!", "Dragon Ball", "Outro"];
const LANGUAGES = ["PT", "EN", "JP", "ES", "FR", "DE", "IT", "KR", "CN"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

type Values = {
  name: string;
  tcg: string;
  collection: string;
  cardNumber: string;
  language: string;
  variant: string;
  condition: string;
  liga: string;
  notes: string;
};
const empty: Values = { name: "", tcg: "Pokémon", collection: "", cardNumber: "", language: "PT", variant: "", condition: "NM", liga: "", notes: "" };

export function CardForm({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const [values, setValues] = useState(empty);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof Values | "photos", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // libera as prévias quando a tela fecha
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setValues((s) => ({ ...s, [k]: e.target.value }));
    setErrors((s) => ({ ...s, [k]: undefined }));
  };

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = [...list].filter((f) => f.type.startsWith("image/")).slice(0, room);
    setPhotos((p) => [...p, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    setErrors((s) => ({ ...s, photos: undefined }));
    if (fileInput.current) fileInput.current.value = "";
  }

  function removePhoto(i: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
  }

  function movePhotoFirst(i: number) {
    setPhotos((p) => [p[i], ...p.filter((_, j) => j !== i)]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const liga = values.liga.trim() ? parseBRL(values.liga) : null;
    const errs: typeof errors = {
      name: values.name.trim() ? undefined : "Informe o nome da carta",
      photos: photos.length ? undefined : "Adicione pelo menos uma foto",
      liga: values.liga.trim() && liga == null ? "Use o formato 12,50" : undefined,
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setFormError("Confira os campos destacados.");
      return;
    }
    setPending(true);
    setFormError(null);
    const sb = createClient();
    const cardId = crypto.randomUUID();
    const uploaded: string[] = [];
    try {
      // fotos primeiro: se alguma falhar, a carta não fica cadastrada sem imagem
      for (const [i, p] of photos.entries()) {
        const blob = await shrinkPhoto(p.file);
        const path = `${sellerId}/${cardId}/${i + 1}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        const { error } = await sb.storage.from(CARD_PHOTOS_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (error) throw error;
        uploaded.push(path);
      }
      const { error: cardError } = await sb.from("cards").insert({
        id: cardId,
        seller_id: sellerId,
        name: values.name.trim(),
        tcg: values.tcg,
        collection: values.collection.trim() || null,
        card_number: values.cardNumber.trim() || null,
        language: values.language || null,
        variant: values.variant.trim() || null,
        condition: values.condition || null,
        liga_price_cents: liga,
        notes: values.notes.trim() || null,
      });
      if (cardError) throw cardError;
      const { error: photoError } = await sb.from("card_photos").insert(uploaded.map((storage_path, position) => ({ card_id: cardId, storage_path, position })));
      if (photoError) {
        await sb.from("cards").delete().eq("id", cardId);
        throw photoError;
      }
      router.replace("/painel/cartas");
      router.refresh();
    } catch {
      if (uploaded.length) await sb.storage.from(CARD_PHOTOS_BUCKET).remove(uploaded);
      setFormError("Não foi possível salvar a carta. Confira a conexão e tente de novo.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <section aria-labelledby="fotos-label" className="flex flex-col gap-1.5">
        <p id="fotos-label" className="text-xs font-semibold text-muted">
          Fotos ({photos.length}/{MAX_PHOTOS}) · a primeira aparece na sala
        </p>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Foto ${i + 1}`} className="aspect-[3/4] w-full rounded-sm border border-line object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label={`Remover foto ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 grid size-8 place-items-center rounded-full bg-bg text-sm"
              >
                ✕
              </button>
              {i > 0 && (
                <button type="button" onClick={() => movePhotoFirst(i)} className="mt-1 w-full text-[11px] font-bold text-accent-text">
                  Usar como capa
                </button>
              )}
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="grid aspect-[3/4] cursor-pointer place-items-center rounded-sm border-2 border-dashed border-line text-center text-xs font-bold text-muted">
              <span>
                <span aria-hidden className="block text-2xl">+</span>
                Foto
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => addPhotos(e.target.files)}
                aria-describedby={errors.photos ? "fotos-erro" : undefined}
              />
            </label>
          )}
        </div>
        {errors.photos && (
          <p id="fotos-erro" className="text-xs font-semibold text-danger">
            {errors.photos}
          </p>
        )}
      </section>

      <Field label="Nome da carta" name="card-name" value={values.name} onChange={set("name")} error={errors.name} maxLength={120} autoComplete="off" />
      <div className="grid grid-cols-2 gap-2">
        <Select label="Jogo" value={values.tcg} onChange={set("tcg")} options={TCGS} />
        <Field label="Variante" placeholder="Holo, Full Art…" value={values.variant} onChange={set("variant")} autoComplete="off" />
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Coleção" value={values.collection} onChange={set("collection")} autoComplete="off" />
        <Field label="Número" placeholder="SWSH262" value={values.cardNumber} onChange={set("cardNumber")} autoComplete="off" spellCheck={false} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select label="Idioma" value={values.language} onChange={set("language")} options={LANGUAGES} />
        <Select label="Condição" value={values.condition} onChange={set("condition")} options={CONDITIONS} />
        <Field label="Preço Liga" placeholder="12,50" inputMode="decimal" value={values.liga} onChange={set("liga")} error={errors.liga} />
      </div>
      <TextArea label="Observações" value={values.notes} onChange={set("notes")} hint="Opcional. Ex.: pequena marca no verso." />
      <FormError message={formError} />
      <Button type="submit" block pending={pending}>
        Salvar carta
      </Button>
    </form>
  );
}
