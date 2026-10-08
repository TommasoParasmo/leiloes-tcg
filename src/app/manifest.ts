import type { MetadataRoute } from "next";

/** Instalação como app (tela inicial do celular). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bate Carta · Leilões ao vivo",
    short_name: "Bate Carta",
    description: "Leilões ao vivo de cartas Pokémon TCG, One Piece, Magic, Lorcana e outros.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#090A12",
    theme_color: "#090A12",
    icons: [
      { src: "/brand/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
