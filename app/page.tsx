import { cookies } from "next/headers";
import Link from "next/link";
import CatalogGrid from "@/components/home/CatalogGrid";
import ContinueReading from "@/components/home/ContinueReading";
import Cover from "@/components/home/Cover";
import Faq from "@/components/home/Faq";
import HowItWorks from "@/components/home/HowItWorks";
import { meta, type CatalogBook } from "@/components/home/types";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import Icon from "@/components/ui/Icon";
import { verifyReaderToken } from "@/lib/auth/reader";
import { readerCookieName } from "@/lib/config";
import { listBooks } from "@/lib/db/repo";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Published only. Drafts and uploads in progress never reach this page.
  const published = (await listBooks()).filter((b) => b.status === "published").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const jar = await cookies();
  const unlockedIds = new Set(
    (await Promise.all(published.map(async (b) => ((await verifyReaderToken(b, jar.get(readerCookieName(b.id))?.value)) ? b.id : null)))).filter((x): x is string => !!x),
  );
  const books: CatalogBook[] = published.map((b) => ({
    slug: b.slug, title: b.title, author: b.author, category: b.category, year: b.year, description: b.description,
    pageCount: b.page_count, updatedAt: b.updated_at, unlocked: unlockedIds.has(b.id),
  }));
  const featured = books[0];
  const unlocked = books.filter((b) => b.unlocked);

  return (
    <>
      <SiteHeader siteName={SITE_NAME} />
      <main className="flex-1">
        {featured ? (
          <section aria-labelledby="destacado" className="border-b border-line bg-surface">
            <div className="mx-auto grid w-full max-w-[1200px] items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,320px)_1fr] md:gap-16 md:py-16">
              <Cover slug={featured.slug} title={featured.title} className="mx-auto w-full max-w-[280px] md:max-w-none" eager />
              <div className="max-w-xl">
                {meta(featured) && <p className="text-[15px] text-muted">{meta(featured)}</p>}
                <h1 id="destacado" className="mt-1 text-4xl md:text-5xl">{featured.title}</h1>
                {featured.author && <p className="mt-2 text-lg text-muted">de {featured.author}</p>}
                {featured.description && <p className="mt-5 line-clamp-4 text-base">{featured.description}</p>}
                <p className="tnum mt-4 text-sm text-muted">{featured.pageCount} páginas</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={`/b/${featured.slug}#leer`} className="btn btn-primary min-h-11 px-6">Leer ahora<Icon name="arrow" size={18} /></Link>
                  <Link href={`/b/${featured.slug}`} className="btn min-h-11 px-6">Ver detalles</Link>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section id="catalogo" className="border-b border-line bg-surface">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6">
              <Icon name="book" size={32} className="text-muted" />
              <h1 className="mt-4 text-4xl">Todavía no hay libros</h1>
              <p className="mt-2 max-w-md text-muted">Cuando se publique el primero aparecerá aquí, y podrás abrirlo con tu código.</p>
            </div>
          </section>
        )}

        <ContinueReading books={unlocked} />

        {books.length > 0 && (
          <section id="catalogo" aria-label="Catálogo" className="mx-auto w-full max-w-[1200px] scroll-mt-20 px-4 pb-16 pt-12 sm:px-6">
            <CatalogGrid books={books} />
          </section>
        )}

        <HowItWorks />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
