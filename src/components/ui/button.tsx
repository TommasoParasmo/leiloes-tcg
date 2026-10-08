import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "success";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent shadow-accent hover:bg-accent-hover",
  secondary: "bg-surface-2 text-text hover:bg-line",
  outline: "border border-line bg-transparent text-text hover:bg-surface-2",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
  success: "bg-win text-[#06231A] hover:brightness-110",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Aguardando o servidor: desativa e mostra um spinner discreto sem mudar o texto. */
  pending?: boolean;
  block?: boolean;
}

export function Button({ variant = "primary", pending, block, className, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "relative inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 font-body text-md font-bold transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-none",
        variants[variant],
        block && "w-full",
        className,
      )}
    >
      {children}
      {pending && <Spinner className="absolute right-3" />}
    </button>
  );
}
