import { cookies } from "next/headers";
import Link from "next/link";
import CatalogGrid from "@/components/home/CatalogGrid";
import ContinueReading from "@/components/home/ContinueReading";
import Cover from "@/components/home/Cover";
import LargeTitle from "@/components/home/LargeTitle";
import Faq from "@/components/home/Faq";
import HowItWorks from "@/components/home/HowItWorks";
import { meta, type CatalogBook } from "@/components/home/types";
import { Logo } from "@/components/brand/Logo";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import Icon from "@/components/ui/Icon";
import RetryButton from "@/components/ui/RetryButton";
import { readableBookIds } from "@/lib/auth/access";
import { verifyReaderToken } from "@/lib/auth/reader";
import { userFromToken } from "@/lib/auth/user-session";
import { readerCookieName, USER_COOKIE } from "@/lib/config";
import { listBooks } from "@/lib/db/repo";
import { progressOf } from "@/lib/db/users";
import { SITE_NAME } from "@/lib/site";
import { softly } from "@/lib/soft";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Published only. Drafts and uploads in progress never reach this page.
  const published = (await listBooks()).filter((b) => b.status === "published").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const jar = await cookies();
  // What this reader has unlocked. If the sheet does not answer right now, the catalogue still shows (all locked)
  // with a notice and "Reintentar", instead of the whole page failing.
  const codes = await Promise.all(published.map((b) => softly(verifyReaderToken(b, jar.get(readerCookieName(b.id))?.value), "down" as const)));
  const unlockedIds = new Set(published.filter((_, i) => codes[i] && codes[i] !== "down").map((b) => b.id));
  // A signed-in reader also has the books of the account, and their synced progress.
  let synced: Record<string, number> | undefined;
  const account = await softly((async () => {
    const session = await userFromToken(jar.get(USER_COOKIE)?.value);
    if (!session) return null;
    const ids = await readableBookIds(session.user, published);
    const slugOf = new Map(published.map((b) => [b.id, b.slug]));
    const out: Record<string, number> = {};
    for (const p of await progressOf(session.user.id)) {
      const slug = slugOf.get(p.book_id);
      if (slug && p.page > 0) out[slug] = p.page;
    }
    return { ids, synced: out };
  })(), "down" as const);
  const partial = account === "down" || codes.includes("down");
  if (account && account !== "down") {
    for (const id of account.ids) unlockedIds.add(id);
    synced = account.synced;
  }
  const books: CatalogBook[] = published.map((b) => ({
    slug: b.slug, title: b.title, author: b.author, category: b.category, year: b.year, description: b.description,
    pageCount: b.page_count, ...(b.page_labels ? { pageLabels: b.page_labels } : {}), updatedAt: b.updated_at, unlocked: unlockedIds.has(b.id),
  }));
  const featured = books[0];
  const unlocked = books.filter((b) => b.unlocked);

  return (
    <>
      <SiteHeader siteName={SITE_NAME} largeTitle />
      <main className="flex-1">
        <LargeTitle title="Libros" intro="Los libros del curso de Aviónica (TMC0). Elige uno e introduce tu código para leerlo." />
        {partial && (
          <div role="status" className="mx-auto w-full max-w-[1200px] px-4 pb-6 sm:px-6" data-testid="partial-notice">
            <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="min-w-0 flex-1 basis-64 text-[15px]">Ahora mismo no podemos cargar tu cuenta (tus libros y tu progreso). El catálogo se muestra igualmente.</p>
              <RetryButton />
            </div>
          </div>
        )}
        {featured ? (
          <section aria-labelledby="destacado" className="border-b border-line bg-surface">
            <div className="mx-auto grid w-full max-w-[1200px] items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,320px)_1fr] md:gap-16 md:py-16">
              <Cover slug={featured.slug} title={featured.title} className="mx-auto w-full max-w-[280px] md:max-w-none" eager />
              <div className="max-w-xl">
                {meta(featured) && <p className="text-[15px] text-muted">{meta(featured)}</p>}
                <h2 id="destacado" className="mt-1 text-4xl md:text-5xl">{featured.title}</h2>
                {featured.author && <p className="mt-2 text-lg text-muted">de {featured.author}</p>}
                {featured.description && <p className="mt-5 line-clamp-4 text-base">{featured.description}</p>}
                <p className="tnum mt-4 text-sm text-muted">{featured.pageCount} páginas</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={`/b/${featured.slug}#leer`} className="btn btn-primary min-h-11 px-6">Leer ahora<Icon name="arrow" size={18} className="nudge" /></Link>
                  <Link href={`/b/${featured.slug}`} className="btn min-h-11 px-6">Ver detalles</Link>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section id="catalogo" className="border-b border-line bg-surface">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6">
              <Logo size={44} className="text-accent" />
              <h2 className="mt-4 text-4xl">Todavía no hay libros</h2>
              <p className="mt-2 max-w-md text-muted">Cuando se publique el primero aparecerá aquí, y podrás abrirlo con tu código.</p>
            </div>
          </section>
        )}

        <ContinueReading books={unlocked} synced={synced} />

        {books.length > 0 && (
          <section id="catalogo" aria-label="Catálogo" className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-12 sm:px-6">
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
