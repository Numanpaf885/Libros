import { randomUUID } from "node:crypto";
import { isMock, SHEET_CACHE_MS } from "../config";
import { assertSafeConfig } from "../safety";
import type { AccessCode, AdminUser, Book, BookStatus } from "../types";
import { mockTable } from "./mock";
import { sheetsTable } from "./sheets";
import type { Table } from "./table";

const table = (): Table => {
  assertSafeConfig();
  return isMock() ? mockTable : sheetsTable;
};

// Read cache (<= 60 s). Local writes invalidate it; on multi-instance deployments
// other instances may see changes up to SHEET_CACHE_MS late.
const cache = (globalThis as unknown as { __readCache?: Map<string, { at: number; rows: string[][] }> });
cache.__readCache ??= new Map();
async function cached(tab: string): Promise<string[][]> {
  const m = cache.__readCache!;
  const hit = m.get(tab);
  if (hit && Date.now() - hit.at < SHEET_CACHE_MS) return hit.rows;
  const rows = await table().list(tab);
  m.set(tab, { at: Date.now(), rows });
  return rows;
}
const bust = (tab: string) => cache.__readCache!.delete(tab);

const toBook = (r: string[]): Book => ({
  id: r[0], slug: r[1], title: r[2], description: r[3],
  page_count: Number(r[4]) || 0, storage_prefix: r[5], cover_path: r[6],
  status: r[7] === "published" ? "published" : r[7] === "uploading" ? "uploading" : "draft", updated_at: r[8],
  // columns added later: older rows simply do not have them
  author: r[9] ?? "", category: r[10] ?? "", year: r[11] ?? "",
});
const fromBook = (b: Book): string[] => [
  b.id, b.slug, b.title, b.description, String(b.page_count),
  b.storage_prefix, b.cover_path, b.status, b.updated_at, b.author, b.category, b.year,
];
const toCode = (r: string[]): AccessCode => ({
  id: r[0], book_id: r[1], code_hash: r[2], label: r[3], created_at: r[4],
  expires_at: r[5], revoked: r[6].toUpperCase() === "TRUE",
});
const fromCode = (c: AccessCode): string[] => [
  c.id, c.book_id, c.code_hash, c.label, c.created_at, c.expires_at, c.revoked ? "TRUE" : "FALSE",
];

export async function listBooks(): Promise<Book[]> {
  return (await cached("books")).filter((r) => r[0]).map(toBook);
}
export async function getBookBySlug(slug: string) {
  return (await listBooks()).find((b) => b.slug === slug) ?? null;
}
export async function getBookById(id: string) {
  return (await listBooks()).find((b) => b.id === id) ?? null;
}
export async function createBook(input: Omit<Book, "id" | "updated_at" | "author" | "category" | "year"> & Partial<Pick<Book, "author" | "category" | "year">>) {
  const book: Book = { author: "", category: "", year: "", ...input, id: randomUUID(), updated_at: new Date().toISOString() };
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
export async function deleteCodesForBook(bookId: string) {
  const n = await table().deleteWhere("access_codes", 1, bookId);
  bust("access_codes");
  return n;
}

export async function getAdmin(username: string): Promise<AdminUser | null> {
  const r = (await table().list("admins")).find((x) => x[0] === username);
  return r ? { username: r[0], password_hash: r[1] } : null;
}

export type { BookStatus };
