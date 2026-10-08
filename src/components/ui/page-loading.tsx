/** Esqueleto enquanto os dados chegam (sem animação chamativa). */
export function PageLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="mx-auto flex w-full max-w-md flex-col gap-3 px-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-24 rounded-md border border-line bg-surface" />
      ))}
    </div>
  );
}
