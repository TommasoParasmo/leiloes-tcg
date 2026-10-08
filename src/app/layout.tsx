import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["500", "700", "800"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: "Bate Carta",
  description: "Leilões ao vivo de cartas Pokémon TCG, One Piece, Magic, Lorcana e outros.",
  applicationName: "Bate Carta",
  openGraph: {
    type: "website",
    siteName: "Bate Carta",
    locale: "pt_BR",
    images: [{ url: "/brand/hero.jpg", alt: "Bate Carta, leilões ao vivo de cartas" }],
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "Bate Carta", statusBarStyle: "black-translucent" },
};

// Tema do sistema antes da primeira pintura (sem piscar): escuro é o padrão.
const themeScript = `(()=>{try{var m=matchMedia("(prefers-color-scheme: light)");var s=function(){document.documentElement.dataset.theme=m.matches?"light":"dark"};s();m.addEventListener("change",s)}catch(e){}})()`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6FB" },
    { media: "(prefers-color-scheme: dark)", color: "#090A12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // o script troca data-theme antes da hidratação
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning className={`${unbounded.variable} ${manrope.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text font-body">{children}</body>
    </html>
  );
}
