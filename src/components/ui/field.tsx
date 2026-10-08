import type { InputHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

/** Campo com rótulo acima, dica e erro (design §5 Inputs). */
export function Field({
  label,
  hint,
  error,
  success,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; success?: string | null }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint || success ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
        className={cn(
          "min-h-[46px] rounded-sm border bg-surface px-3.5 text-md text-text placeholder:text-muted",
          error ? "border-danger" : success ? "border-win" : "border-line",
        )}
      />
      {error ? (
        <p id={`${id}-err`} className="text-xs font-semibold text-danger">
          {error}
        </p>
      ) : success ? (
        <p id={`${id}-hint`} className="text-xs font-semibold text-win">
          {success}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-sm bg-danger/15 px-3 py-2 text-sm font-semibold text-danger">
      {message}
    </p>
  );
}
