import "server-only";
import { listBooks } from "./db/repo";
import { listDownloads } from "./db/users";
import type { DownloadRecord } from "./types";

export const LOG_PAGE_SIZE = 50;
export interface LogQuery { user?: string; book?: string; from?: string; to?: string; page?: number; size?: number }
export interface LogRow extends DownloadRecord {
  /** pages of the book now (null when the book no longer exists), so the screen can say "Todo (1–366)" */
  book_total: number | null;
}

const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Newest first, filtered by user ("admin" = the admin's own downloads), book and date range, one page at a time. */
export async function queryLog(q: LogQuery) {
  const all = await listDownloads();
  const from = q.from ? ms(q.from) : null;
  const to = q.to ? ms(q.to) : null;
  const hit = all.filter((d) =>
    (!q.user || (q.user === "admin" ? d.actor === "admin" : d.actor === "user" && d.user_id === q.user)) &&
    (!q.book || d.book_id === q.book) &&
    (from === null || Date.parse(d.created_at) >= from) &&
    (to === null || Date.parse(d.created_at) <= to));
  hit.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const books = new Map((await listBooks()).map((b) => [b.id, b.page_count]));
  const withTotal = (d: DownloadRecord): LogRow => ({ ...d, book_total: books.get(d.book_id) ?? null });

  // Choices for the filters come from the whole log, so people and books that no longer exist can still be picked.
  const users = new Map<string, string>();
  const bookNames = new Map<string, string>();
  for (const d of [...all].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (d.actor === "user" && d.user_id) users.set(d.user_id, `${d.display_name} (@${d.username})`);
    if (d.book_id) bookNames.set(d.book_id, d.book_title);
  }
  const size = q.size ?? LOG_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(hit.length / size));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return {
    total: hit.length, page, pages, size,
    rows: hit.slice((page - 1) * size, page * size).map(withTotal),
    all: hit.map(withTotal),
    filters: {
      users: [...users].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "es")),
      books: [...bookNames].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "es")),
      has_admin: all.some((d) => d.actor === "admin"),
    },
  };
}

const STATUS_ES: Record<DownloadRecord["status"], string> = { completed: "Completada", cancelled: "Cancelada", failed: "Fallida", started: "En curso" };
export const statusEs = (s: DownloadRecord["status"]) => STATUS_ES[s];
export const pagesLabel = (d: Pick<DownloadRecord, "from_page" | "to_page"> & { book_total: number | null }) =>
  d.from_page === 1 && d.book_total === d.to_page ? `Todo (1–${d.to_page})` : d.from_page === d.to_page ? String(d.from_page) : `${d.from_page}–${d.to_page}`;
export const userLabel = (d: DownloadRecord) => (d.actor === "admin" ? "Admin" : `${d.display_name} (@${d.username})`);
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\./g, "");

/** A cell that starts with = + - @ would be run as a formula by Excel: prefix it. Quote when needed. */
const cell = (v: string) => {
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
/** CSV for Excel in Spain: UTF-8 with BOM, ";" as the separator, CRLF lines. */
export function toCsv(rows: LogRow[]): string {
  const head = ["Fecha y hora", "Usuario", "Libro", "Páginas", "Nº de páginas", "Dispositivo", "Estado"];
  const lines = rows.map((d) => [when(d.created_at), userLabel(d), d.book_title, pagesLabel(d), String(d.page_count), d.device, statusEs(d.status)]);
  return "﻿" + [head, ...lines].map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}
