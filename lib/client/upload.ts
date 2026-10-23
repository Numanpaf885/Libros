"use client";
import { api } from "./api";
import { imagesFingerprint, openImages, type ImagePlan } from "./images";
import { COVER_W, openPdf, type OpenPdf } from "./render-pdf";
import { ChunkWriter, finishText, textState } from "./text-store";
import { chunkCount, chunkOf, TEXT_CHUNK } from "@/lib/text-layer";

const BATCH = 20; // presigned URLs requested per call
const PARALLEL = 4; // simultaneous PUTs

export interface Progress {
  done: number;
  total: number;
  etaSec: number | null;
}
export type UploadMode = "new" | "resume" | "replace";
/** A source of pages: an opened PDF, or photos (with an optional separate cover). */
type PageSource = OpenPdf & { renderCover?: (maxWidth: number) => Promise<Blob> };
export interface FlowOptions {
  /** The PDF. Omit it when uploading `images`. */
  file?: File;
  /** Images instead of a PDF: in their final order, with the cover. */
  images?: ImagePlan;
  mode: UploadMode;
  /** new: title/description. resume: the uploading row's id. replace: the live book's id. */
  bookId?: string;
  meta?: { title: string; description: string; author?: string; category?: string; year?: string };
  /** status to apply when the upload completes */
  status: "published" | "draft";
  /** also store the text of each page for the readers' selectable layer (PDFs only; the sheet must have the text columns) */
  text?: boolean;
  onProgress: (p: Progress) => void;
  signal: AbortSignal;
}

const fpKey = (id: string) => `br:fp:${id}`;
const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const stKey = (id: string) => `br:status:${id}`;
// Remembered in this browser so a resumed upload finishes with the status chosen at the start.
const remember = (id: string, fp: string, status: string) => {
  try { localStorage.setItem(fpKey(id), fp); localStorage.setItem(stKey(id), status); } catch { /* ignore */ }
};
const recall = (id: string) => { try { return localStorage.getItem(fpKey(id)); } catch { return null; } };
const recallStatus = (id: string): "published" | "draft" | null => {
  try { const v = localStorage.getItem(stKey(id)); return v === "published" || v === "draft" ? v : null; } catch { return null; }
};

/** Fetches presigned PUT URLs lazily, 20 at a time, in the order pages will be uploaded. */
class UrlSource {
  private urls = new Map<number, string>();
  constructor(private bookId: string, private order: number[], private signal: AbortSignal) {}
  private async fetchFor(pages: number[]) {
    const r = await api<{ urls: { page: number; url: string }[] }>("/api/admin/upload-urls", "POST", { book_id: this.bookId, pages });
    for (const u of r.urls) this.urls.set(u.page, u.url);
  }
  async get(page: number): Promise<string> {
    this.signal.throwIfAborted();
    if (!this.urls.has(page)) {
      const i = this.order.indexOf(page);
      await this.fetchFor(this.order.slice(i, i + BATCH));
    }
    return this.urls.get(page)!;
  }
  async refresh(page: number): Promise<string> {
    this.urls.delete(page);
    await this.fetchFor([page]);
    return this.urls.get(page)!;
  }
}

async function put(src: UrlSource, page: number, blob: Blob, signal: AbortSignal) {
  let url = await src.get(page);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" }, signal });
      if (res.ok) return;
      throw new Error(`upload ${res.status}`);
    } catch (e) {
      if (signal.aborted || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
      url = await src.refresh(page); // the URL may have expired or been rejected
    }
  }
}

/** Renders `pdf` page by page and uploads whatever the server doesn't already have. */
async function uploadMissing(pdf: PageSource, bookId: string, o: FlowOptions) {
  const st = await api<{ page_count: number; pages: number[]; cover: boolean }>(`/api/admin/books/${bookId}/upload-state`);
  const have = new Set(st.pages);
  const todo: number[] = [];
  if (!st.cover) todo.push(0); // 0 = cover
  for (let n = 1; n <= pdf.pageCount; n++) if (!have.has(n)) todo.push(n);

  const total = pdf.pageCount;
  let done = have.size;
  const started = Date.now();
  let sessionDone = 0;
  const report = () => {
    const remaining = todo.filter((n) => n > 0).length - sessionDone;
    const eta = sessionDone >= 3 ? Math.round((remaining * (Date.now() - started)) / sessionDone / 1000) : null;
    o.onProgress({ done, total, etaSec: remaining <= 0 ? 0 : eta });
  };
  report();

  // The text of the pages is an extra step: the chunks already stored are skipped (so a resumed upload reads only the
  // text that is missing) and any failure here only stops the text, never the page images.
  let text: ChunkWriter | null = null;
  let textStarted = false;
  const textDone = new Set<number>();
  if (o.text && pdf.text) {
    try {
      const s = await textState(bookId);
      if (s.ready) {
        text = new ChunkWriter(bookId, pdf.pageCount, o.signal);
        textStarted = true;
        for (let k = 0; k < chunkCount(pdf.pageCount); k++) if (s.pages[k * TEXT_CHUNK] !== "-") textDone.add(k);
      }
    } catch { text = null; }
  }
  const needText = (n: number) => text !== null && !textDone.has(chunkOf(n));
  const order = [...todo];
  for (let n = 1; n <= pdf.pageCount; n++) if (have.has(n) && needText(n)) order.push(n);
  order.sort((a, b) => a - b);

  const src = new UrlSource(bookId, todo, o.signal);
  const inflight = new Set<Promise<void>>();
  let failure: unknown = null;

  for (const page of order) {
    o.signal.throwIfAborted();
    if (failure) break;
    if (page > 0 && needText(page)) {
      try { await text!.add(page, (await pdf.text!(page)) ?? []); } catch (e) { if (o.signal.aborted) throw e; text = null; }
    }
    if (page > 0 && have.has(page)) continue; // only its text was missing
    while (inflight.size >= PARALLEL) await Promise.race(inflight); // backpressure: render only when a slot is free
    if (failure) break;
    const blob = page === 0 && pdf.renderCover ? await pdf.renderCover(COVER_W) : await pdf.render(page === 0 ? 1 : page, page === 0 ? COVER_W : undefined);
    const p: Promise<void> = put(src, page, blob, o.signal)
      .then(() => {
        if (page > 0) { done++; sessionDone++; report(); }
      })
      .catch((e) => { failure ??= e; })
      .finally(() => { inflight.delete(p); });
    inflight.add(p);
  }
  await Promise.all(inflight);
  if (failure) throw failure;
  o.signal.throwIfAborted();
  if (textStarted) await finishText(bookId).catch(() => {}); // text_status / text_pages of the book, from the chunks stored
}

/**
 * The whole upload: open the local PDF (never uploaded), create/locate the "uploading" row,
 * upload missing pages, finalize. An interruption leaves the row in "uploading" so the same
 * file can be re-selected to continue.
 */
export async function uploadFlow(o: FlowOptions): Promise<string> {
  const pdf: PageSource = o.images ? openImages(o.images) : await openPdf(o.file!);
  const fp = o.images ? imagesFingerprint(o.images.items) : fingerprint(o.file!);
  try {
    let bookId: string;
    if (o.mode === "resume") {
      bookId = o.bookId!;
      const row = await api<{ page_count: number }>(`/api/admin/books/${bookId}/upload-state`);
      const saved = recall(bookId);
      if (row.page_count !== pdf.pageCount || (saved && saved !== fp)) {
        throw new Error("This is not the file this upload started with.");
      }
    } else if (o.mode === "replace") {
      const r = await api<{ book: { id: string; page_count: number } }>(`/api/admin/books/${o.bookId}/replace`, "POST", { page_count: pdf.pageCount });
      bookId = r.book.id;
      const saved = recall(bookId);
      if (r.book.page_count !== pdf.pageCount || (saved && saved !== fp)) {
        throw new Error("A replacement upload is already in progress for a different file. Discard it first.");
      }
      remember(bookId, fp, o.status);
    } else {
      const r = await api<{ book: { id: string } }>("/api/admin/books", "POST", { ...o.meta, page_count: pdf.pageCount });
      bookId = r.book.id;
      remember(bookId, fp, o.status);
    }
    await uploadMissing(pdf, bookId, o);
    const status = o.mode === "new" ? o.status : (recallStatus(bookId) ?? o.status);
    await api(`/api/admin/books/${bookId}/finalize`, "POST", { status });
    try { localStorage.removeItem(fpKey(bookId)); localStorage.removeItem(stKey(bookId)); } catch { /* ignore */ }
    return bookId;
  } finally {
    await pdf.destroy();
  }
}

export function formatEta(sec: number | null): string {
  if (sec === null) return "calculando…";
  if (sec < 60) return `quedan ${sec} s`;
  return `quedan ${Math.floor(sec / 60)} min ${sec % 60} s`;
}
