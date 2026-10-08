/**
 * Destino interno seguro para ?next=. Resolve como o navegador resolveria
 * ("/\evil.com" vira "//evil.com") e só aceita se continuar no próprio site.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/")) return fallback;
  const base = "https://interno.invalid";
  try {
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
