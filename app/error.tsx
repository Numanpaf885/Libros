"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { LegalLinks } from "@/components/layout/SiteFooter";
import ErrorState from "@/components/ui/ErrorState";

// Any page whose data could not be read (Google Sheets slow, over quota or down: the server gives up after 8 s)
// lands here instead of loading forever. "Reintentar" renders the page again.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { console.error(error); }, [error]);
  return (
    <>
      <header className="mx-auto flex w-full max-w-[1200px] items-center px-4 pt-6 sm:px-6">
        <Link href="/" className="press inline-flex min-h-11 items-center gap-2.5 font-serif text-2xl font-semibold"><Logo size={30} className="text-accent" />Libros</Link>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-12 sm:px-6" data-testid="page-error">
        <ErrorState
          title="No se ha podido cargar la página"
          text="El servicio no responde ahora mismo. Espera unos segundos y vuelve a intentarlo."
          busy={busy}
          onRetry={() => { setBusy(true); retry(); setTimeout(() => setBusy(false), 1500); }}
        />
      </main>
      <footer className="border-t border-line text-sm text-muted">
        <LegalLinks className="mx-auto w-full max-w-[1200px] px-3 py-2 sm:px-5" />
      </footer>
    </>
  );
}
