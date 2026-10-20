import "server-only";
import { avgPageBytes } from "./books";
import { finishDownload, getDownloadFresh, methodColumnReady } from "./db/users";
import { GET_TTL_S, originalKey, storage } from "./storage";
import type { Book, DownloadRecord } from "./types";

/** What the download dialog needs to choose a method. */
export async function downloadInfo(book: Book) {
  // Without the downloads.method column a download cannot record how it was made: only the page-image method is offered.
  const original = book.original_pdf_size > 0 && (await methodColumnReady());
  return { original_pdf_size: original ? book.original_pdf_size : 0, avg_page_bytes: await avgPageBytes(book) };
}

/**
 * The presigned URL (60 s) of the book's original PDF for ONE download that was started with method "original" (the whole
 * book, sent as is) or "recorte" (the browser cuts pages from it). A "sent" download is marked in the same step and its
 * URL can be issued only once; a "recorte" one can ask again while it is still running.
 */
export async function issueOriginalUrl(book: Book, row: DownloadRecord | undefined, allow: (d: DownloadRecord) => boolean): Promise<{ url: string; size: number } | null> {
  if (!row || row.book_id !== book.id || row.status !== "started" || !allow(row)) return null;
  if (row.method !== "original" && row.method !== "recorte") return null;
  if (book.original_pdf_size <= 0) return null;
  if (row.method === "original" && !(row.from_page === 1 && row.to_page === book.page_count)) return null;
  if (row.method === "original") {
    const r = await finishDownload(row.id, "sent", allow);
    if (r.state !== "ok") return null;
  }
  const url = await storage().presignDownload(originalKey(book.storage_prefix), `${book.slug}.pdf`, GET_TTL_S);
  return { url, size: book.original_pdf_size };
}
export const findDownload = getDownloadFresh;
