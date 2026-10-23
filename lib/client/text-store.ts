"use client";
// Admin: storing the text of a book's pages (the reader's selectable layer) as JSON chunks of 20 pages, straight to
// storage through presigned URLs, and reading back what is already stored (so extraction and OCR can continue).
import { api } from "./api";
import { chunkOf, chunkRange, parseChunk, TEXT_CHUNK, type PageText, type TextChunk, type TextItem } from "@/lib/text-layer";
import type { OpenPdf } from "./render-pdf";

const route = (bookId: string) => `/api/admin/books/${bookId}/text`;
export interface TextState {
  ready: boolean;
  page_count: number;
  text_status: "none" | "partial" | "full";
  text_pages: number;
  allow_copy: boolean;
  has_original: boolean;
  original_size: number;
  /** pages with no text that were never recognised */
  pending: number;
  /** pages read from the PDF without any text (scans) */
  scanned: number;
  /** one character per page: t text, o recognised, s scan, b blank after OCR, - not processed */
  pages: string;
}
export const textState = (bookId: string) => api<TextState>(route(bookId));
export const finishText = (bookId: string) => api<Pick<TextState, "text_status" | "text_pages" | "pending" | "scanned" | "pages">>(route(bookId), "POST", { action: "finish" });

/** Uploads one chunk (the pages given, in order). The URL is asked again once if the PUT is refused (it may have expired). */
export async function putChunk(bookId: string, k: number, pages: PageText[], signal?: AbortSignal) {
  const body: TextChunk = { v: 1, pages: [...pages].sort((a, b) => a.n - b.n) };
  const json = JSON.stringify(body);
  for (let attempt = 1; ; attempt++) {
    const { urls } = await api<{ urls: { chunk: number; url: string }[] }>(route(bookId), "POST", { action: "urls", chunks: [k] });
    try {
      const res = await fetch(urls[0].url, { method: "PUT", body: json, headers: { "Content-Type": "application/json" }, signal });
      if (res.ok) return;
      throw new Error(`text ${res.status}`);
    } catch (e) {
      if (signal?.aborted || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** The pages already stored in chunk k (empty when the chunk does not exist yet). */
export async function readChunk(bookId: string, k: number, pageCount: number): Promise<Map<number, PageText>> {
  const { urls } = await api<{ urls: { chunk: number; url: string | null }[] }>(route(bookId), "POST", { action: "read", chunks: [k] });
  if (!urls[0]?.url) return new Map();
  const res = await fetch(urls[0].url, { cache: "no-store" });
  if (res.status === 404 || res.status === 403) return new Map();
  if (!res.ok) throw new Error(`text ${res.status}`);
  const { from, to } = chunkRange(k, pageCount);
  return parseChunk(await res.json().catch(() => null), from, to);
}

/**
 * Collects the text of pages as they are read and uploads each chunk as soon as all its pages are in. Used while a
 * PDF is uploaded (an extra step: a failure here never stops the page images) and by "Extraer texto".
 */
export class ChunkWriter {
  private open = new Map<number, PageText[]>();
  constructor(private bookId: string, private pageCount: number, private signal?: AbortSignal) {}
  async add(n: number, items: TextItem[]) {
    const k = chunkOf(n);
    const list = this.open.get(k) ?? [];
    list.push({ n, src: "pdf", items });
    this.open.set(k, list);
    const { from, to } = chunkRange(k, this.pageCount);
    if (list.length === to - from + 1) {
      this.open.delete(k);
      await putChunk(this.bookId, k, list, this.signal);
    }
  }
}

export class PageCountError extends Error {
  constructor(public pdfPages: number, public bookPages: number) { super("page count"); }
}

/**
 * "Extraer texto": reads the text of every page of the book's PDF (the stored original or a local file) and stores it,
 * replacing what was there. The PDF must have exactly the book's page count.
 */
export async function extractText(o: { bookId: string; pageCount: number; open: () => Promise<OpenPdf>; onProgress: (done: number, total: number) => void; signal: AbortSignal }) {
  const pdf = await o.open();
  try {
    if (pdf.pageCount !== o.pageCount) throw new PageCountError(pdf.pageCount, o.pageCount);
    await api(route(o.bookId), "POST", { action: "clear" });
    const w = new ChunkWriter(o.bookId, o.pageCount, o.signal);
    o.onProgress(0, o.pageCount);
    for (let n = 1; n <= o.pageCount; n++) {
      o.signal.throwIfAborted();
      let items: TextItem[] = [];
      try { items = (await pdf.text?.(n)) ?? []; } catch (e) { if (o.signal.aborted) throw e; } // an unreadable page counts as a page without text
      await w.add(n, items);
      o.onProgress(n, o.pageCount);
    }
    return await finishText(o.bookId);
  } finally {
    await pdf.destroy();
  }
}

/** Pages of a chunk (as a list) for a quick lookup. */
export const pagesOf = (k: number, pageCount: number) => {
  const { from, to } = chunkRange(k, pageCount);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};
export { TEXT_CHUNK };
