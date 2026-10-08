"use client";
import { useEffect, useRef } from "react";

/**
 * Painel que sobe de baixo (design: .sheet), em <dialog> modal: foco preso, Esc e
 * toque fora fecham. Montar para abrir, desmontar para fechar.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // fechamento feito pela limpeza do efeito (tela escondida ou remontagem), não pela pessoa
  const silentClose = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      // a navegação do Next pode esconder a tela sem desmontar: um modal aberto deixaria a
      // página seguinte sem receber toques. Fecha sem avisar onClose; ao voltar, reabre.
      silentClose.current = true;
      dialog.close();
      html.style.overflow = previous;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (silentClose.current) {
          silentClose.current = false;
          return;
        }
        onClose();
      }}
      aria-label={title}
      onClick={(e) => {
        // toque no fundo escuro (fora do conteúdo) fecha
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[24px] border border-b-0 border-line bg-bg p-0 text-text backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-3 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2">
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 font-display text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-11 place-items-center" aria-label="Fechar">
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-surface-2">
              ✕
            </span>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
