import Link from "next/link";

/** Logo oficial (SVG em curvas, não recriar com fonte). */
export function Logo() {
  return (
    <Link href="/" aria-label="Bate Carta, início" className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/batecarta-logo-escuro.svg" alt="Bate Carta" width={125} height={24} className="h-6 w-auto" />
    </Link>
  );
}
