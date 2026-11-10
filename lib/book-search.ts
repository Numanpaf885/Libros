import "server-only";
// The text of a book, read from its stored chunks once and kept in memory for a while (per server instance), for the
// reader's search and for the downloads (which pages have text, and from where). Keyed by the book's last change, so
// new text (extraction, OCR, "Volver a extraer") is read again.
import { pageMap, readAllText } from "./book-text";
import { textColumnsReady } from "./db/repo";
import { indexPage, searchPages, type SearchResult } from "./text-search";
import type { PageText } from "./text-layer";
import type { Book } from "./types";

const TTL_MS = 10 * 60_000;
const KEEP = 4; // books kept at once
interface Entry { key: string; at: number; pages: Map<number, PageText>; index?: ReturnType<typeof indexPage>[] }
const g = globalThis as unknown as { __bookText?: Map<string, Entry>; __bookTextLoading?: Map<string, Promise<Entry>> };
g.__bookText ??= new Map();
g.__bookTextLoading ??= new Map();
const keyOf = (b: Book) => `${b.updated_at}|${b.text_pages}|${b.page_count}`;

async function entry(book: Book): Promise<Entry> {
  const m = g.__bookText!, key = keyOf(book);
  const hit = m.get(book.id);
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit;
  const loads = g.__bookTextLoading!, lk = `${book.id}|${key}`;
  let p = loads.get(lk);
  if (!p) {
    p = readAllText(book).then((pages) => {
      const e: Entry = { key, at: Date.now(), pages };
      m.delete(book.id);
      m.set(book.id, e);
      while (m.size > KEEP) m.delete(m.keys().next().value as string);
      return e;
    }).finally(() => loads.delete(lk));
    loads.set(lk, p);
  }
  return p;
}

/** The book has text that can be searched (some page has text, and the sheet has the text columns). */
export async function bookSearchable(book: Book): Promise<boolean> {
  return book.text_pages > 0 && (await textColumnsReady());
}

/** Searches the book's text. `snippets`: false when the admin does not allow copying (pages and boxes only). */
export async function searchBook(book: Book, query: string, snippets: boolean): Promise<SearchResult> {
  const e = await entry(book);
  e.index ??= [...e.pages.values()].filter((p) => p.items.length).sort((a, b) => a.n - b.n).map((p) => indexPage(p.n, p.items));
  return searchPages(e.index, query, snippets);
}

/** One character per page: "t" text from the PDF, "o" recognised by OCR, anything else none (see pageMap). */
export async function bookTextMap(book: Book): Promise<string> {
  if (!(await bookSearchable(book))) return "";
  return pageMap((await entry(book)).pages, book.page_count);
}
