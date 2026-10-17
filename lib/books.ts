import { storage } from "./storage";
import { OBJECT_RE, PREFIX_RE, REPLACE_SLUG } from "./storage/constants";
import type { AdminBook, Book } from "./types";

export const isReplacement = (b: Book) => b.slug.startsWith(REPLACE_SLUG);
export const replacementTarget = (b: Book) => b.slug.slice(REPLACE_SLUG.length);

export const toAdminBook = (b: Book, pending: Book | null = null): AdminBook => ({
  id: b.id, slug: b.slug, title: b.title, description: b.description,
  page_count: b.page_count, status: b.status, updated_at: b.updated_at,
  author: b.author, category: b.category, year: b.year,
  pending_replacement: pending?.id ?? null,
});

/** Which pages (and the cover) are already stored under this book's prefix. */
export async function uploadState(b: Book): Promise<{ pages: number[]; cover: boolean }> {
  const have = await storage().list(b.storage_prefix);
  const pages: number[] = [];
  let cover = false;
  for (const k of have) {
    const m = OBJECT_RE.exec(k);
    if (!m) continue;
    if (m[1] === "cover") cover = true;
    else if (Number(m[1]) <= b.page_count) pages.push(Number(m[1]));
  }
  return { pages: pages.sort((a, b2) => a - b2), cover };
}

/** Confirms cover + pages 1..count all exist before an upload is trusted. */
export async function verifyUpload(prefix: string, count: number): Promise<boolean> {
  if (!PREFIX_RE.test(prefix) || count < 1 || count > 5000) return false;
  const have = new Set(await storage().list(prefix));
  if (!have.has(`${prefix}/cover.webp`)) return false;
  for (let n = 1; n <= count; n++) if (!have.has(`${prefix}/${n}.webp`)) return false;
  return true;
}
