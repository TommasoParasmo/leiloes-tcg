import { AppBar } from "@/components/layout/app-bar";
import { TERMS_VERSION } from "@/lib/legal";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

/** Texto longo de termos/política: leitura confortável no celular. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <AppBar back="/" title={title} />
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2 text-[15px] leading-relaxed [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:font-bold [&_a]:text-accent-text [&_a]:underline">
        <p className="text-sm text-muted">Versão de {dateFmt.format(new Date(`${TERMS_VERSION}T12:00:00Z`))}</p>
        {children}
      </main>
    </>
  );
}
