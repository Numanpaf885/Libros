import Link from "next/link";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { SITE_NAME } from "@/lib/site";

export default function NotFound() {
  return (
    <>
      <SiteHeader siteName={SITE_NAME} />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-20 sm:px-6">
        <h1 className="text-4xl">Página no encontrada</h1>
        <p className="mt-2 max-w-md text-muted">Este libro no existe o todavía no está publicado.</p>
        <Link href="/" className="btn btn-primary mt-6">Volver al catálogo</Link>
      </main>
      <SiteFooter />
    </>
  );
}
