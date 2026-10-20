"use client";
// Uploads the ORIGINAL PDF of a book to R2 as an S3 multipart upload: the server creates and completes it, the browser
// PUTs 16 MB parts (3 at a time) to presigned URLs and never needs to read an ETag (the server lists the parts itself).
// The upload id and the finished parts are remembered in this browser, so an interrupted upload continues with only the
// missing parts. Cancel (the user's choice) aborts the upload on the server; an error or a closed tab leaves it resumable.
import { api } from "./api";

export const PART_SIZE = 16 * 1024 * 1024;
const PARALLEL = 3;
const BATCH = 20;

export interface OriginalProgress { done: number; total: number; resumed: boolean }
interface Saved { uploadId: string; fp: string; size: number }
const key = (bookId: string) => `br:orig:${bookId}`;
export const fileFingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const recall = (bookId: string): Saved | null => {
  try { const v = JSON.parse(localStorage.getItem(key(bookId)) ?? "null") as Saved | null; return v && typeof v.uploadId === "string" ? v : null; } catch { return null; }
};
const remember = (bookId: string, s: Saved) => { try { localStorage.setItem(key(bookId), JSON.stringify(s)); } catch { /* ignore */ } };
const forget = (bookId: string) => { try { localStorage.removeItem(key(bookId)); } catch { /* ignore */ } };
/** An interrupted original upload of this book is remembered in this browser. */
export const hasPendingOriginal = (bookId: string) => recall(bookId) !== null;

const route = (bookId: string) => `/api/admin/books/${bookId}/original`;

/** Aborts (on the server too) an upload that was started and not finished. Never throws. */
export async function abortOriginal(bookId: string): Promise<void> {
  const s = recall(bookId);
  forget(bookId);
  if (s) await api(route(bookId), "POST", { action: "abort", uploadId: s.uploadId }).catch(() => {});
}

/** PUT with progress (fetch cannot report upload progress). Resolves on 2xx. */
function putPart(url: string, body: Blob, signal: AbortSignal, onBytes: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`part ${x.status}`)));
    x.onerror = () => reject(new Error("part network"));
    x.onabort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    const stop = () => x.abort();
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    x.send(body);
  });
}

export interface UploadOriginalOptions {
  bookId: string;
  file: File;
  /** the PDF's page count (already checked against the book's) */
  pages: number;
  /** compact printed-page ranges found in the PDF, saved if the book has none ("" = none) */
  pageLabels?: string;
  onProgress: (p: OriginalProgress) => void;
  signal: AbortSignal;
}

export async function uploadOriginal(o: UploadOriginalOptions): Promise<void> {
  const { bookId, file, signal } = o;
  const total = Math.ceil(file.size / PART_SIZE);
  const fp = fileFingerprint(file);
  let uploadId = "";
  const have = new Map<number, number>(); // part -> size already stored on the server
  let resumed = false;

  const saved = recall(bookId);
  if (saved && saved.fp === fp && saved.size === file.size) {
    try {
      const r = await api<{ parts: { part: number; size: number }[] }>(route(bookId), "POST", { action: "parts", uploadId: saved.uploadId });
      uploadId = saved.uploadId;
      for (const p of r.parts) have.set(p.part, p.size);
      resumed = have.size > 0;
    } catch { forget(bookId); } // the upload is gone on the server: start again
  } else if (saved) {
    await abortOriginal(bookId); // a different file: the old upload cannot continue
  }
  if (!uploadId) {
    const r = await api<{ uploadId: string }>(route(bookId), "POST", { action: "start", size: file.size, pages: o.pages });
    uploadId = r.uploadId;
    remember(bookId, { uploadId, fp, size: file.size });
  }

  const sizeOf = (n: number) => Math.min(PART_SIZE, file.size - (n - 1) * PART_SIZE);
  const todo: number[] = [];
  let doneBytes = 0;
  for (let n = 1; n <= total; n++) {
    if (have.get(n) === sizeOf(n)) doneBytes += sizeOf(n); else todo.push(n);
  }
  const inflight = new Map<number, number>(); // bytes sent so far of the parts in flight
  const report = () => {
    let sent = doneBytes;
    for (const v of inflight.values()) sent += v;
    o.onProgress({ done: Math.min(sent, file.size), total: file.size, resumed });
  };
  report();

  const urls = new Map<number, string>();
  const fetchUrls = async (parts: number[]) => {
    const r = await api<{ urls: { part: number; url: string }[] }>(route(bookId), "POST", { action: "urls", uploadId, parts });
    for (const u of r.urls) urls.set(u.part, u.url);
  };
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (!failure) {
      signal.throwIfAborted();
      const i = next++;
      if (i >= todo.length) return;
      const n = todo[i];
      if (!urls.has(n)) await fetchUrls(todo.slice(i, i + BATCH).filter((p) => !urls.has(p)));
      const blob = file.slice((n - 1) * PART_SIZE, (n - 1) * PART_SIZE + sizeOf(n));
      for (let attempt = 1; ; attempt++) {
        try {
          inflight.set(n, 0);
          await putPart(urls.get(n)!, blob, signal, (l) => { inflight.set(n, l); report(); });
          break;
        } catch (e) {
          inflight.delete(n);
          if (signal.aborted || attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 600 * attempt));
          urls.delete(n);
          await fetchUrls([n]); // the URL may have expired
        }
      }
      inflight.delete(n);
      doneBytes += sizeOf(n);
      report();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, () => worker().catch((e) => { failure ??= e; })));
  } finally {
    inflight.clear();
  }
  if (failure) throw failure;
  signal.throwIfAborted();
  await api(route(bookId), "POST", { action: "complete", uploadId, size: file.size, pages: o.pages, page_labels: o.pageLabels ?? "" });
  forget(bookId);
}
