import { useId } from "react";

/** Lista de opções com rótulo acima, no mesmo estilo do Field. */
export function Select({ label, options, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: string[] }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <select id={id} {...rest} className="min-h-[46px] rounded-sm border border-line bg-surface px-3 text-md text-text">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export function TextArea({ label, hint, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <textarea id={id} rows={2} aria-describedby={hint ? `${id}-hint` : undefined} {...rest} className="rounded-sm border border-line bg-surface px-3.5 py-2.5 text-md text-text" />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
