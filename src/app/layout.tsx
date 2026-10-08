import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["500", "700", "800"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Bate Carta",
  description: "Leilões ao vivo de cartas Pokémon TCG, One Piece, Magic, Lorcana e outros.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090A12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" data-theme="dark" className={`${unbounded.variable} ${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text font-body">{children}</body>
    </html>
  );
}
