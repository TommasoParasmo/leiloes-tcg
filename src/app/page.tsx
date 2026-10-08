export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-6">
      <header className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-sm bg-holo font-display text-lg font-extrabold text-on-accent">
          L
        </span>
        <span className="font-display text-lg font-bold">Leilão TCG</span>
      </header>

      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <p className="text-xs font-extrabold uppercase tracking-[.06em] text-muted">Em construção</p>
        <h1 className="mt-2 font-display text-2xl font-bold">Leilões ao vivo de cartas colecionáveis</h1>
        <p className="mt-3 text-muted">
          Pokémon, One Piece, Magic, Lorcana e outros. Lances em tempo real, resultado oficial pelo site e
          publicação no grupo do WhatsApp.
        </p>
      </section>
    </main>
  );
}
