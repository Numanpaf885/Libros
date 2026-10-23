"use client";
// "Reconocer texto (OCR)": recognises the text of a book's stored page images with tesseract.js, which runs in its own
// Web Worker (the admin page stays responsive). Everything it needs is served by this site from /ocr/ (copied from
// node_modules by scripts/copy-ocr-assets.mjs): no CDN. Admin only, loaded on demand.
// Each page is saved as soon as it is recognised, so a pause (or a closed tab) loses at most the page in progress.
import { api } from "./api";
import { finishText, putChunk, readChunk } from "./text-store";
import { chunkOf, itemsFromOcr, type PageText } from "@/lib/text-layer";

export interface OcrProgress { done: number; total: number; etaSec: number | null }
const LANGS = ["spa", "eng"];

async function pageImage(bookId: string, n: number, signal: AbortSignal): Promise<Blob> {
  for (let attempt = 1; ; attempt++) {
    const r = await api<{ urls: { page: number; url: string }[] }>(`/api/admin/books/${bookId}/page-urls`, "POST", { pages: [n] });
    try {
      const res = await fetch(r.urls[0].url, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`page ${res.status}`);
      return await res.blob();
    } catch (e) {
      if (signal.aborted || attempt >= 2) throw e;
    }
  }
}

/**
 * Recognises `pages` (in order) and stores their text as word boxes. Stops at once when `signal` aborts (pause): the
 * worker is terminated and the page in progress is done again next time. Updates the book's text status at the end.
 */
export async function runOcr(o: { bookId: string; pageCount: number; pages: number[]; onProgress: (p: OcrProgress) => void; signal: AbortSignal }): Promise<void> {
  const { createWorker, OEM } = await import("tesseract.js");
  o.signal.throwIfAborted();
  const worker = await createWorker(LANGS, OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false,
  });
  const paused = new Promise<never>((_, reject) => o.signal.addEventListener("abort", () => reject(o.signal.reason), { once: true }));
  paused.catch(() => {});
  const stop = () => { void worker.terminate(); };
  o.signal.addEventListener("abort", stop, { once: true });
  const total = o.pages.length;
  const t0 = Date.now();
  let done = 0;
  o.onProgress({ done, total, etaSec: null });
  try {
    let chunk = -1;
    let stored = new Map<number, PageText>();
    for (const n of o.pages) {
      o.signal.throwIfAborted();
      if (chunkOf(n) !== chunk) {
        chunk = chunkOf(n);
        stored = await readChunk(o.bookId, chunk, o.pageCount); // keep the other pages of this chunk
      }
      const blob = await pageImage(o.bookId, n, o.signal);
      const bmp = await createImageBitmap(blob);
      const size = { w: bmp.width, h: bmp.height };
      bmp.close();
      // a terminated worker may never answer: the pause itself ends the wait
      const { data } = await Promise.race([worker.recognize(blob, {}, { text: false, blocks: true }), paused]);
      o.signal.throwIfAborted();
      const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
      stored.set(n, { n, src: "ocr", items: itemsFromOcr(lines, size.w, size.h) });
      await putChunk(o.bookId, chunk, [...stored.values()], o.signal);
      done++;
      const per = (Date.now() - t0) / done;
      o.onProgress({ done, total, etaSec: done >= 1 ? Math.round((per * (total - done)) / 1000) : null });
    }
  } finally {
    o.signal.removeEventListener("abort", stop);
    if (!o.signal.aborted) await worker.terminate().catch(() => {});
    await finishText(o.bookId).catch(() => {});
  }
}
