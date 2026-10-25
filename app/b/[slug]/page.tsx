import { notFound } from "next/navigation";
import BookClient from "@/components/book/BookClient";
import { readerHasText } from "@/lib/book-text";
import { getBookBySlug } from "@/lib/db/repo";
import { SITE_CONTACT, SITE_NAME } from "@/lib/site";
import { softly } from "@/lib/soft";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const b = await softly(getBookBySlug((await params).slug), null); // the page itself reports the problem
  return { title: b && b.status === "published" ? b.title : "Libro", robots: { index: false, follow: false } };
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const book = await getBookBySlug((await params).slug);
  if (!book || book.status !== "published") notFound();
  // Public presentation fields only. Never keys, prefixes or hashes.
  return (
    <BookClient
      book={{ slug: book.slug, title: book.title, author: book.author, category: book.category, year: book.year, description: book.description, pageCount: book.page_count, pageLabels: book.page_labels, text: await readerHasText(book) }}
      contact={SITE_CONTACT}
      siteName={SITE_NAME}
    />
  );
}
