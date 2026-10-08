"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/chips";
import { Field, FormError } from "@/components/ui/field";
import { Select, TextArea } from "@/components/ui/select";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { shrinkPhoto } from "@/lib/image";
import { parseBRL } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

const MAX_PHOTOS = 4;
const TCGS = ["Pokémon", "One Piece", "Magic", "Lorcana", "Yu-Gi-Oh!", "Dragon Ball", "Outro"];
const LANGUAGES = ["PT", "EN", "JP", "Outro"] as const;
const CONDITIONS = ["M", "NM", "LP", "MP", "HP", "D"] as const;

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

// Rascunho dos campos de texto no aparelho (fotos não cabem no localStorage).
const draftKey = (sellerId: string) => `bate-carta:rascunho-carta:${sellerId}`;
function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, v: Values | null) {
  try {
    if (v && v.name.trim()) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    // modo privado ou armazenamento cheio: segue sem rascunho
  }
}
const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function CardForm({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const key = draftKey(sellerId);
  // rascunho que já estava salvo quando a tela abriu (oferecido num aviso, não aplicado sozinho)
  const storedDraft = useSyncExternalStore(subscribeStorage, () => readDraft(key), () => null);
  const [draftDecided, setDraftDecided] = useState(false);
  const [values, setValues] = useState(empty);
  const [touched, setTouched] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof Values | "photos", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState<"stay" | "leave" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLDivElement>(null);

  // libera as prévias quando a tela fecha
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  let offeredDraft: Values | null = null;
  if (storedDraft && !draftDecided && !touched) {
    try {
      offeredDraft = { ...empty, ...(JSON.parse(storedDraft) as Partial<Values>) };
    } catch {
      offeredDraft = null;
    }
  }

  function update(k: keyof Values, v: string) {
    setTouched(true);
    setSaved(null);
    setValues((s) => {
      const next = { ...s, [k]: v };
      writeDraft(key, next);
      return next;
    });
    setErrors((s) => ({ ...s, [k]: undefined }));
  }
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => update(k, e.target.value);

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = [...list].filter((f) => f.type.startsWith("image/")).slice(0, room);
    setPhotos((p) => [...p, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    setErrors((s) => ({ ...s, photos: undefined }));
    setSaved(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removePhoto(i: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
  }

  function makeCover(i: number) {
    setPhotos((p) => [p[i], ...p.filter((_, j) => j !== i)]);
  }

  async function save(then: "stay" | "leave") {
    if (pending) return;
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
    setPending(then);
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
    } catch {
      if (uploaded.length) await sb.storage.from(CARD_PHOTOS_BUCKET).remove(uploaded);
      setFormError("Não foi possível salvar a carta. Confira a conexão e tente de novo.");
      setPending(null);
      return;
    }
    writeDraft(key, null);
    if (then === "leave") {
      router.replace("/painel/cartas");
      router.refresh();
      return;
    }
    // "Salvar e nova": mantém jogo, coleção, idioma e condição, que costumam se repetir no lote
    const name = values.name.trim();
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setValues((s) => ({ ...empty, tcg: s.tcg, collection: s.collection, language: s.language, condition: s.condition }));
    setTouched(false);
    setDraftDecided(true);
    setSaved(`${name} salva. Cadastre a próxima.`);
    setPending(null);
    nameInput.current?.querySelector("input")?.focus();
    window.scrollTo({ top: 0 });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save("leave");
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      <p aria-live="polite" className="sr-only">
        {saved ?? ""}
      </p>
      {saved && <p className="rounded-sm bg-win/15 px-3 py-2 text-sm font-semibold text-win">{saved}</p>}
      {offeredDraft && (
        <div className="flex items-center gap-2 rounded-sm border border-line bg-surface p-2 pl-3 text-sm">
          <p className="min-w-0 flex-1">
            Rascunho de <b className="break-words">{offeredDraft.name}</b>
          </p>
          <button
            type="button"
            className="min-h-11 px-2 font-bold text-muted"
            onClick={() => {
              writeDraft(key, null);
              setDraftDecided(true);
            }}
          >
            Descartar
          </button>
          <button
            type="button"
            className="min-h-11 rounded-sm bg-surface-2 px-3 font-bold"
            onClick={() => {
              setValues(offeredDraft);
              setDraftDecided(true);
            }}
          >
            Continuar
          </button>
        </div>
      )}

      <section aria-labelledby="fotos-label" className="flex flex-col gap-1.5">
        <p id="fotos-label" className="text-xs font-semibold text-muted">
          Fotos (até {MAX_PHOTOS})
        </p>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              {i === 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="Foto 1, capa" className="aspect-[63/88] w-full rounded-sm border-2 border-accent object-cover" />
              ) : (
                <button type="button" onClick={() => makeCover(i)} aria-label={`Usar foto ${i + 1} como capa`} className="block w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="aspect-[63/88] w-full rounded-sm border border-line object-cover" />
                </button>
              )}
              {i === 0 && (
                <span aria-hidden className="absolute bottom-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-extrabold text-on-accent">
                  Capa
                </span>
              )}
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label={`Remover foto ${i + 1}`}
                className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-line bg-bg text-sm"
              >
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="grid aspect-[63/88] cursor-pointer place-items-center rounded-sm border-2 border-dashed border-line text-center text-xs font-bold text-muted has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              <span>
                <span aria-hidden className="block text-2xl">
                  +
                </span>
                Foto
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => addPhotos(e.target.files)}
                aria-describedby={errors.photos ? "fotos-erro" : "fotos-dica"}
              />
            </label>
          )}
        </div>
        {errors.photos ? (
          <p id="fotos-erro" className="text-xs font-semibold text-danger">
            {errors.photos}
          </p>
        ) : (
          <p id="fotos-dica" className="text-xs text-muted">
            Frente, verso e detalhes. Toque numa foto para virar a capa.
          </p>
        )}
      </section>

      <div ref={nameInput}>
        <Field label="Nome da carta" name="card-name" value={values.name} onChange={set("name")} error={errors.name} maxLength={120} autoComplete="off" />
      </div>
      <Select label="Jogo" value={values.tcg} onChange={set("tcg")} options={TCGS} />
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Coleção" value={values.collection} onChange={set("collection")} autoComplete="off" />
        <Field label="Número" placeholder="SWSH262" value={values.cardNumber} onChange={set("cardNumber")} autoComplete="off" spellCheck={false} />
      </div>
      <ChoiceChips label="Idioma" options={LANGUAGES} value={values.language} onChange={(v) => update("language", v)} />
      <ChoiceChips label="Condição" options={CONDITIONS} value={values.condition} onChange={(v) => update("condition", v)} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Variante" placeholder="Holo, Promo…" value={values.variant} onChange={set("variant")} autoComplete="off" />
        <Field label="Preço Liga (opcional)" placeholder="12,50" inputMode="decimal" value={values.liga} onChange={set("liga")} error={errors.liga} />
      </div>
      <TextArea label="Observações" value={values.notes} onChange={set("notes")} hint="Opcional. Ex.: pequena marca no verso." />
      <FormError message={formError} />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="min-h-[52px]" pending={pending === "stay"} disabled={!!pending} onClick={() => void save("stay")}>
          Salvar e nova
        </Button>
        <Button type="submit" className="min-h-[52px]" pending={pending === "leave"} disabled={!!pending}>
          Salvar carta
        </Button>
      </div>
    </form>
  );
}
