import "server-only";
import { randomUUID } from "node:crypto";
import { SHEET_CACHE_MS } from "../config";
import { assertSafeConfig } from "../safety";
import type { AccessCode, AdminUser, Book } from "../types";
import { mockTableOn } from "./backend";
import { mockTable } from "./mock";
import { sheetsTable } from "./sheets";
import { deleteBookmarksForBook } from "./users";
import type { Table } from "./table";

const table = (): Table => {
  assertSafeConfig();
  return mockTableOn() ? mockTable : sheetsTable;
};

// Read cache (<= 60 s). Local writes invalidate it; on multi-instance deployments
// other instances may see changes up to SHEET_CACHE_MS late. When a refresh fails (Google slow or over quota) the
// last good rows keep being used for a while, so the catalogue and the reader keep working.
const STALE_RETRY_MS = 15_000;
type Entry = { at: number; rows: string[][]; retryAt?: number };
const cache = (globalThis as unknown as { __readCache?: Map<string, Entry> });
cache.__readCache ??= new Map();
const loading = new Map<string, Promise<string[][]>>();
/** Bumped by every local write: a read that started before it must not put the old rows back in the cache. */
const generation = new Map<string, number>();
async function cached(tab: string): Promise<string[][]> {
  const m = cache.__readCache!;
  const hit = m.get(tab);
  if (hit && (Date.now() - hit.at < SHEET_CACHE_MS || Date.now() < (hit.retryAt ?? 0))) return hit.rows;
  let p = loading.get(tab);
  if (!p) {
    const gen = generation.get(tab) ?? 0;
    const job: Promise<string[][]> = table().list(tab)
      .then((rows) => { if ((generation.get(tab) ?? 0) === gen) m.set(tab, { at: Date.now(), rows }); return rows; })
      .finally(() => { if (loading.get(tab) === job) loading.delete(tab); });
    p = job;
    loading.set(tab, job);
  }
  try {
    return await p;
  } catch (e) {
    if (!hit) throw e;
    hit.retryAt = Date.now() + STALE_RETRY_MS;
    console.warn(`[${tab}] refresh failed, using the copy from ${Math.round((Date.now() - hit.at) / 1000)} s ago:`, (e as Error).message);
    return hit.rows;
  }
}
/** After a local write: the next read is fresh (an older read still on its way is not shared nor cached). */
const bust = (tab: string) => {
  cache.__readCache!.delete(tab);
  loading.delete(tab);
  generation.set(tab, (generation.get(tab) ?? 0) + 1);
};
/** Drop every cached tab (after "Actualizar base de datos" added columns: rows are read again at their new width). */
export function forgetReadCache() {
  for (const tab of [...cache.__readCache!.keys(), ...loading.keys()]) bust(tab);
}

const toBook = (r: string[]): Book => ({
  id: r[0], slug: r[1], title: r[2], description: r[3],
  page_count: Number(r[4]) || 0, storage_prefix: r[5], cover_path: r[6],
  status: r[7] === "published" ? "published" : r[7] === "uploading" ? "uploading" : "draft", updated_at: r[8],
  // columns added later: older rows simply do not have them
  author: r[9] ?? "", category: r[10] ?? "", year: r[11] ?? "",
  page_labels: r[12] ?? "", original_pdf_size: Number(r[13]) || 0, original_pdf_pages: Number(r[14]) || 0,
  text_status: r[15] === "full" || r[15] === "partial" ? r[15] : "none", text_pages: Number(r[16]) || 0,
  allow_copy: (r[17] ?? "").toUpperCase() !== "FALSE", // empty = the default (on)
});
const fromBook = (b: Book): string[] => [
  b.id, b.slug, b.title, b.description, String(b.page_count),
  b.storage_prefix, b.cover_path, b.status, b.updated_at, b.author, b.category, b.year,
  b.page_labels, b.original_pdf_size ? String(b.original_pdf_size) : "", b.original_pdf_pages ? String(b.original_pdf_pages) : "",
  b.text_status === "none" ? "" : b.text_status, b.text_pages ? String(b.text_pages) : "", b.allow_copy ? "" : "FALSE",
];
const toCode = (r: string[]): AccessCode => ({
  id: r[0], book_id: r[1], code_hash: r[2], label: r[3], created_at: r[4],
  expires_at: r[5], revoked: r[6].toUpperCase() === "TRUE",
});
const fromCode = (c: AccessCode): string[] => [
  c.id, c.book_id, c.code_hash, c.label, c.created_at, c.expires_at, c.revoked ? "TRUE" : "FALSE",
];

/**
 * The original-PDF and page-numbering features need the three columns `npm run setup-sheet` appends to `books`.
 * Without them nothing about those features is stored, so they stay hidden (and their routes answer 409).
 */
export async function bookExtrasReady(): Promise<boolean> {
  return table().hasColumn("books", 12, "page_labels");
}
/** The selectable text needs books.text_status / text_pages / allow_copy. Without them the reader shows no text layer. */
export async function textColumnsReady(): Promise<boolean> {
  const t = table();
  return (await t.hasColumn("books", 15, "text_status")) && (await t.hasColumn("books", 16, "text_pages")) && (await t.hasColumn("books", 17, "allow_copy"));
}

export async function listBooks(): Promise<Book[]> {
  return (await cached("books")).filter((r) => r[0]).map(toBook);
}
export async function getBookBySlug(slug: string) {
  return (await listBooks()).find((b) => b.slug === slug) ?? null;
}
export async function getBookById(id: string) {
  return (await listBooks()).find((b) => b.id === id) ?? null;
}
type Optional = "author" | "category" | "year" | "page_labels" | "original_pdf_size" | "original_pdf_pages" | "text_status" | "text_pages" | "allow_copy";
export async function createBook(input: Omit<Book, "id" | "updated_at" | Optional> & Partial<Pick<Book, Optional>>) {
  const book: Book = { author: "", category: "", year: "", page_labels: "", original_pdf_size: 0, original_pdf_pages: 0, text_status: "none", text_pages: 0, allow_copy: true, ...input, id: randomUUID(), updated_at: new Date().toISOString() };
  await table().append("books", fromBook(book));
  bust("books");
  return book;
}
export async function saveBook(b: Book) {
  const next = { ...b, updated_at: new Date().toISOString() };
  await table().updateById("books", b.id, fromBook(next));
  bust("books");
  return next;
}
export async function deleteBookRow(id: string) {
  const n = await table().deleteWhere("books", 0, id);
  bust("books");
  // bookmarks of a deleted book go with it; this must never make the deletion fail
  await deleteBookmarksForBook(id).catch(() => {});
  return n;
}

export async function listCodes(bookId: string): Promise<AccessCode[]> {
  return (await cached("access_codes")).filter((r) => r[0] && r[1] === bookId).map(toCode);
}
export async function getCode(id: string): Promise<AccessCode | null> {
  const r = (await cached("access_codes")).find((x) => x[0] === id);
  return r ? toCode(r) : null;
}
export async function findCodeByHash(bookId: string, hash: string): Promise<AccessCode | null> {
  const r = (await cached("access_codes")).find((x) => x[1] === bookId && x[2] === hash);
  return r ? toCode(r) : null;
}
export async function addCodes(codes: AccessCode[]) {
  for (const c of codes) await table().append("access_codes", fromCode(c));
  bust("access_codes");
}
export async function setRevoked(id: string, revoked: boolean): Promise<boolean> {
  // Read fresh (not cached) so we never overwrite with stale columns.
  const rows = await table().list("access_codes");
  const r = rows.find((x) => x[0] === id);
  if (!r) return false;
  const c = { ...toCode(r), revoked };
  await table().updateById("access_codes", id, fromCode(c));
  bust("access_codes");
  return true;
}
/** Replaces the code's hash under a NEW id (same label, expiry, created_at). Sessions hold the old id, so they die at once. */
export async function changeCode(id: string, newHash: string): Promise<AccessCode | null> {
  const rows = await table().list("access_codes");
  const r = rows.find((x) => x[0] === id);
  if (!r) return null;
  const next: AccessCode = { ...toCode(r), id: randomUUID(), code_hash: newHash };
  await table().updateById("access_codes", id, fromCode(next));
  bust("access_codes");
  return next;
}
/** Same code, same id, new hash: used to move an old SHA-256 hash to the keyed HMAC after a successful match. */
export async function upgradeCodeHash(id: string, hash: string): Promise<void> {
  const rows = await table().list("access_codes");
  const r = rows.find((x) => x[0] === id);
  if (!r) return;
  await table().updateById("access_codes", id, fromCode({ ...toCode(r), code_hash: hash }));
  bust("access_codes");
}
export async function deleteCodesForBook(bookId: string) {
  const n = await table().deleteWhere("access_codes", 1, bookId);
  bust("access_codes");
  return n;
}

export async function getAdmin(username: string): Promise<AdminUser | null> {
  const r = (await table().list("admins")).find((x) => x[0] === username);
  return r ? { username: r[0], password_hash: r[1] } : null;
}

