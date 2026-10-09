"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/chips";
import { Field, FormError } from "@/components/ui/field";
import { Select, TextArea } from "@/components/ui/select";
import { CARD_PHOTOS_BUCKET } from "@/lib/auction/data";
import { canOpenPhoto, shrinkPhoto, withTimeout } from "@/lib/image";
import { PokemonLookup } from "./pokemon-lookup";
import { cardSummary } from "@/lib/card-summary";
import { MAX_PRICE_CENTS, parseBRL } from "@/lib/money";
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
  price: string;
  notes: string;
};
const empty: Values = { name: "", tcg: "Pokémon", collection: "", cardNumber: "", language: "PT", variant: "", condition: "NM", notes: "", price: "" };

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

export function CardForm({ sellerId, eventId }: { sellerId: string; eventId?: string }) {
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
  const cameraInput = useRef<HTMLInputElement>(null);
  // idioma, condição, preço e o resto ficam escondidos: PT e NM já vêm marcados
  const [more, setMore] = useState(false);

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

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const files = [...list];
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
    const room = MAX_PHOTOS - photos.length;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const candidates = images.slice(0, room);
    // confere já na escolha se o aparelho abre a foto (HEIC, por exemplo, não abre em todo navegador)
    const readable = (await Promise.all(candidates.map(async (f) => ((await canOpenPhoto(f)) ? f : null)))).filter((f): f is File => f !== null);
    setPhotos((p) => [...p, ...readable.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
    const unreadable = candidates.length - readable.length + (files.length - images.length);
    const extra = images.length - candidates.length;
    const notes = [
      unreadable > 0 && (unreadable === 1 ? "Uma foto não abriu neste aparelho. Use JPG ou PNG, ou tire pela câmera." : `${unreadable} fotos não abriram neste aparelho. Use JPG ou PNG, ou tire pela câmera.`),
      extra > 0 && `Cabem só ${MAX_PHOTOS} fotos: ${extra === 1 ? "uma ficou de fora" : `${extra} ficaram de fora`}.`,
    ].filter(Boolean);
    setErrors((s) => ({ ...s, photos: notes.length ? notes.join(" ") : undefined }));
    setSaved(null);
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
    const price = parseBRL(values.price);
    const errs: typeof errors = {
      name: values.name.trim() ? undefined : "Informe o nome da carta",
      photos: photos.length ? undefined : "Adicione pelo menos uma foto",
      // só rapidez por enquanto: quem tocar primeiro leva por este preço
      price: price && price > MAX_PRICE_CENTS ? "O preço máximo é R$ 100.000" : price && price > 0 ? undefined : values.price.trim() ? "Use o formato 25 ou 12,50" : "Informe o mínimo da Liga",
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
    let cardSent = false;
    try {
      // fotos primeiro: se alguma falhar, a carta não fica cadastrada sem imagem
      for (const [i, p] of photos.entries()) {
        const blob = await withTimeout(shrinkPhoto(p.file), 30_000);
        const path = `${sellerId}/${cardId}/${i + 1}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        // anotado antes de enviar: se o envio estourar o prazo e chegar depois, a limpeza abaixo ainda apaga
        uploaded.push(path);
        // rede de celular pode travar sem erro: desiste e avisa em vez de girar para sempre
        const { error } = await withTimeout(sb.storage.from(CARD_PHOTOS_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" }), 60_000);
        if (error) throw error;
      }
      cardSent = true;
      const { error: cardError } = await sb
        .from("cards")
        .insert({
        id: cardId,
        seller_id: sellerId,
        name: values.name.trim(),
        tcg: values.tcg,
        collection: values.collection.trim() || null,
        card_number: values.cardNumber.trim() || null,
        language: values.language || null,
        variant: values.variant.trim() || null,
        condition: values.condition || null,
        liga_price_cents: price,
        price_cents: price,
        notes: values.notes.trim() || null,
      })
        // cancela de verdade a gravação que travar (o servidor desiste em vez de gravar depois)
        .abortSignal(AbortSignal.timeout(30_000));
      if (cardError) throw cardError;
      const { error: photoError } = await sb.from("card_photos").insert(uploaded.map((storage_path, position) => ({ card_id: cardId, storage_path, position })));
      if (photoError) {
        await sb.from("cards").delete().eq("id", cardId);
        throw photoError;
      }
    } catch {
      // a carta pode ter sido gravada mesmo com a resposta perdida: apaga para não ficar sem fotos
      if (cardSent) await sb.from("cards").delete().eq("id", cardId);
      if (uploaded.length) await sb.storage.from(CARD_PHOTOS_BUCKET).remove(uploaded);
      setFormError("Não foi possível salvar a carta. Confira a conexão e tente de novo.");
      setPending(null);
      return;
    }
    writeDraft(key, null);
    const name = values.name.trim();
    // limpa a tela nos dois casos: o Next guarda esta tela montada e a mostra de novo como ficou
    // (sem isso, a próxima carta abria com a anterior preenchida e o botão girando)
    // mantém jogo, coleção, idioma e condição, que costumam se repetir no lote
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setValues((s) => ({ ...empty, tcg: s.tcg, collection: s.collection, language: s.language, condition: s.condition }));
    setTouched(false);
    setMore(false);
    setDraftDecided(true);
    setErrors({});
    setPending(null);
    if (then === "leave") {
      setSaved(null);
      router.replace(eventId ? `/painel/eventos/${eventId}?carta=${cardId}` : "/painel/cartas");
      router.refresh();
      return;
    }
    setSaved(`${name} salva. Tire a foto da próxima.`);
    // volta para o quadro da câmera (abrir a câmera sozinho o celular não deixa: precisa do toque)
    window.scrollTo({ top: 0 });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save("leave");
      }}
      onKeyDown={(e) => {
        // "ir"/Enter do teclado do celular num campo de uma linha só fecha o teclado; salvar é pelos botões
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          e.target.blur();
        }
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

      <section aria-label="Fotos" className="flex flex-col items-center gap-2">
        {photos.length ? (
          <div className="relative w-[62%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[0].url} alt="Foto da carta" className="aspect-[63/88] w-full rounded-md border-2 border-accent object-cover" />
            <button
              type="button"
              onClick={() => removePhoto(0)}
              aria-label="Remover foto"
              className="absolute -right-3 -top-3 grid size-10 place-items-center rounded-full border border-line bg-bg text-base"
            >
              ✕
            </button>
          </div>
        ) : (
          // um toque abre a câmera traseira no celular (no computador abre a escolha de arquivo)
          <label className="grid aspect-[63/88] w-[62%] cursor-pointer place-items-center rounded-md border-2 border-dashed border-accent/70 bg-accent/10 text-center font-bold text-accent-text has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <span className="flex flex-col items-center gap-2 px-3">
              <svg aria-hidden viewBox="0 0 24 24" className="size-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
                <circle cx="12" cy="13.5" r="3.5" />
              </svg>
              <span className="text-lg">Tirar foto da carta</span>
              <span className="text-xs font-semibold text-muted">Encaixe a carta no quadro</span>
            </span>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void addPhotos(e.target.files)}
              aria-describedby={errors.photos ? "fotos-erro" : undefined}
            />
          </label>
        )}
        {photos.length > 1 && (
          <ul className="flex gap-2">
            {photos.slice(1).map((p, j) => (
              <li key={p.url} className="relative">
                <button type="button" onClick={() => makeCover(j + 1)} aria-label={`Usar foto ${j + 2} como principal`} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="aspect-[63/88] w-12 rounded-[5px] border border-line object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(j + 1)}
                  aria-label={`Remover foto ${j + 2}`}
                  className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border border-line bg-bg text-[11px]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_PHOTOS && (
          <div className="flex items-center gap-1 text-sm font-bold text-muted">
            {photos.length > 0 && (
              // mais uma foto pela câmera (verso, detalhe): nem todo celular oferece a câmera na galeria
              <>
                <label className="flex min-h-11 cursor-pointer items-center px-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                  + Foto do verso ou detalhe
                  <input
                    ref={cameraInput}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => void addPhotos(e.target.files)}
                    aria-describedby={errors.photos ? "fotos-erro" : undefined}
                  />
                </label>
                <span aria-hidden>·</span>
              </>
            )}
            <label className="flex min-h-11 cursor-pointer items-center px-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              {photos.length ? "Galeria" : "ou escolher da galeria"}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => void addPhotos(e.target.files)}
                aria-describedby={errors.photos ? "fotos-erro" : undefined}
              />
            </label>
          </div>
        )}
        {errors.photos && (
          <p id="fotos-erro" className="text-center text-xs font-semibold text-danger">
            {errors.photos}
          </p>
        )}
      </section>

      <Field label="Nome da carta" name="card-name" value={values.name} onChange={set("name")} error={errors.name} maxLength={120} autoComplete="off" placeholder="Ex.: Pikachu ex" />
      {values.tcg === "Pokémon" && (
        <PokemonLookup
          query={values.name}
          language={values.language}
          onPick={(c) => {
            update("name", c.name);
            if (c.collection) update("collection", c.collection);
            if (c.cardNumber) update("cardNumber", c.cardNumber);
          }}
        />
      )}

      <Field
        label="Mínimo da Liga (R$)"
        placeholder="Ex.: 10"
        inputMode="decimal"
        value={values.price}
        onChange={set("price")}
        error={errors.price}
        hint="Os 4 botões do leilão começam neste valor. Ex.: 10, 11, 12, 13."
      />

      <div className="flex items-center justify-between gap-2.5 rounded-sm border border-line bg-surface px-3 py-2 text-[13px]">
        <span className="min-w-0">{cardSummary(values)}</span>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="min-h-10 shrink-0 px-1 font-extrabold text-accent-text">
          {more ? "Pronto" : "Mudar"}
        </button>
      </div>
      {more && (
        <div className="flex flex-col gap-3">
          <ChoiceChips label="Idioma" options={LANGUAGES} value={values.language} onChange={(v) => update("language", v)} />
          <ChoiceChips label="Condição" options={CONDITIONS} value={values.condition} onChange={(v) => update("condition", v)} />
          <Select label="Jogo" value={values.tcg} onChange={set("tcg")} options={TCGS} />
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Field label="Coleção" value={values.collection} onChange={set("collection")} autoComplete="off" />
            <Field label="Número" placeholder="SWSH262" value={values.cardNumber} onChange={set("cardNumber")} autoComplete="off" spellCheck={false} />
          </div>
          <Field label="Variante" placeholder="Holo, Promo…" value={values.variant} onChange={set("variant")} autoComplete="off" />
          <TextArea label="Observações" value={values.notes} onChange={set("notes")} hint="Opcional. Ex.: pequena marca no verso." />
        </div>
      )}
      <FormError message={formError} />
      <Button type="button" block className="min-h-[72px] font-display text-xl" pending={pending === "stay"} disabled={!!pending} onClick={() => void save("stay")}>
        Salvar e próxima foto
      </Button>
      <button type="submit" disabled={!!pending} aria-busy={pending === "leave" || undefined} className="-mt-1 min-h-11 text-sm font-bold text-muted disabled:opacity-50">
        {pending === "leave" ? "Salvando…" : eventId ? "Salvar e pôr no leilão" : "Salvar e terminar"}
      </button>
    </form>
  );
}
