"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Foto da carta (design §4b e §5 CardArt): recorte cover com véu escuro para os rótulos.
 * O toque abre a foto ampliada com as fotos adicionais.
 */
export function CardArt({ photos, label, alt }: { photos: string[]; label: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const main = photos[0];
  return (
    <>
      <button
        type="button"
        onClick={() => main && setOpen(true)}
        className="relative block h-[180px] w-full overflow-hidden rounded-md border border-line bg-surface text-left"
        aria-label={`Ampliar foto de ${alt}`}
      >
        {main ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main} alt={alt} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-sm text-muted">Sem foto</span>
        )}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(9,10,18,.15),transparent_35%,transparent_60%,rgba(9,10,18,.55))]" />
        <span className="absolute left-3 top-3 rounded-pill bg-bg/80 px-2.5 py-1 text-[11px] font-extrabold tabular">{label}</span>
        {main && <span className="absolute bottom-3 right-3 rounded-pill bg-bg/80 px-2.5 py-1 text-[11px] font-bold">⤢ Ampliar</span>}
      </button>
      {open && <Lightbox photos={photos} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Foto ampliada em <dialog> modal: foco preso no diálogo, Esc fecha e o foco volta à foto. */
function Lightbox({ photos, alt, onClose }: { photos: string[]; alt: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      // sem dialog.close() aqui: o evento "close" fecharia de novo na remontagem do StrictMode
      html.style.overflow = previous;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={`Fotos de ${alt}`}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overscroll-contain bg-black/95 p-0 text-text backdrop:bg-transparent"
    >
      <div className="flex h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        <div className="flex justify-end p-2">
          {/* alvo de 48 px com o círculo de 40 px do design */}
          <button type="button" autoFocus onClick={onClose} className="group grid size-12 place-items-center" aria-label="Fechar">
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-surface-2 text-lg">
              ✕
            </span>
          </button>
        </div>
        {/* touch-action: pinch-zoom deixa a pinça do navegador ampliar a foto */}
        <div className="flex flex-1 items-center justify-center overflow-auto px-2 [touch-action:pinch-zoom]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[index]} alt={`${alt}, foto ${index + 1}`} className="max-h-full max-w-full object-contain" />
        </div>
        {photos.length > 1 && (
          <div className="flex justify-center gap-2 p-4">
            {photos.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index || undefined}
                className={`size-14 overflow-hidden rounded-[5px] border-2 ${i === index ? "border-accent" : "border-transparent"}`}
                aria-label={`Foto ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
