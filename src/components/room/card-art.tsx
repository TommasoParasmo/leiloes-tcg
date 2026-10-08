"use client";
import { useEffect, useState } from "react";

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

function Lightbox({ photos, alt, onClose }: { photos: string[]; alt: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal aria-label={`Fotos de ${alt}`} className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex justify-end p-3">
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-surface-2 text-lg" aria-label="Fechar">
          ✕
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
  );
}
