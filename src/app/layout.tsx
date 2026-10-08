import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { publicEnv } from "@/lib/env";
import { THEME_COLORS } from "@/lib/theme";
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

// Tema antes da primeira pintura (sem piscar): a escolha salva pelo botão vale; sem ela, segue o
// sistema (escuro é o padrão).
const themeScript = `(()=>{try{var m=matchMedia("(prefers-color-scheme: light)");var s=function(){var t=null;try{t=localStorage.getItem("theme")}catch(e){}var d=document.documentElement;d.dataset.theme=t==="light"||t==="dark"?t:m.matches?"light":"dark";if(t)document.querySelectorAll('meta[name="theme-color"]').forEach(function(e){e.content=d.dataset.theme==="light"?"${THEME_COLORS.light}":"${THEME_COLORS.dark}"})};s();m.addEventListener("change",s);new MutationObserver(function(r){if(r.some(function(x){return[].some.call(x.addedNodes,function(n){return n.nodeName==="META"})}))s()}).observe(document,{childList:true,subtree:true})}catch(e){}})()`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
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
