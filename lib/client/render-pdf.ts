"use client";
import { itemsFromRuns, runsFromPdf, type TextItem } from "@/lib/text-layer";

const MAX_W = 1400;
export const COVER_W = 480;
const QUALITY = 0.8;
/** Largest single read from the local file. pdf.js may ask for a longer range; we assemble it from reads this size. */
const READ_CHUNK = 64 * 1024;
/** Range requests to a stored original: fewer, larger reads than from a local file. */
const NET_CHUNK = 512 * 1024;

async function readRange(file: File, begin: number, end: number): Promise<Uint8Array> {
  const out = new Uint8Array(end - begin);
  for (let at = begin; at < end; at += READ_CHUNK) {
    const part = new Uint8Array(await file.slice(at, Math.min(at + READ_CHUNK, end)).arrayBuffer());
    out.set(part, at - begin);
  }
  return out;
}

export interface OpenPdf {
  pageCount: number;
  /** Render page n (1-based) to a WebP blob no wider than maxWidth. Frees all canvas memory before returning. */
  render(n: number, maxWidth?: number): Promise<Blob>;
  /** The text of page n for the selectable layer (lines, as fractions of the page); [] when the page has none. PDFs only. */
  text?(n: number): Promise<TextItem[]>;
  destroy(): Promise<void>;
}

/** Where pdf.js reads the bytes from: a local file, or a stored original through Range requests. */
interface Source { size: number; chunk: number; read(begin: number, end: number): Promise<Uint8Array> }
const fileSource = (file: File): Source => ({ size: file.size, chunk: READ_CHUNK, read: (b, e) => readRange(file, b, Math.min(e, file.size)) });

/**
 * The stored original PDF, read in pieces with Range requests. `getUrl` hands out a fresh 60 s presigned URL; it is
 * asked again before the old one expires and when a request is refused, so a long extraction never stalls.
 */
export function urlSource(size: number, getUrl: () => Promise<string>): Source {
  let cur: { url: string; at: number } | null = null;
  const url = async (fresh = false) => {
    if (fresh || !cur || Date.now() - cur.at > 40_000) cur = { url: await getUrl(), at: Date.now() };
    return cur.url;
  };
  const once = async (begin: number, end: number, fresh: boolean) => {
    const res = await fetch(await url(fresh), { headers: { Range: `bytes=${begin}-${end - 1}` }, cache: "no-store" });
    if (res.status !== 206 && res.status !== 200) throw new Error(`range ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return res.status === 200 ? buf.slice(begin, end) : buf; // a server that ignores Range sends the whole file
  };
  return {
    size, chunk: NET_CHUNK,
    async read(begin, end) {
      end = Math.min(end, size);
      try { return await once(begin, end, false); } catch { return once(begin, end, true); } // one retry with a fresh URL
    },
  };
}

/**
 * Opens a PDF WITHOUT reading it all into memory: pdf.js asks for byte ranges and we answer each one from the
 * source. An 800 MB file therefore costs only what pages need. A read that fails makes every later call fail.
 */
async function openDocument(src: Source) {
  // The legacy build carries the polyfills (Map.prototype.getOrInsertComputed and friends) that the modern one expects
  // the browser to have: without them pdf.js fails in browsers that are only a few months old.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

  let fail: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  failed.catch(() => {});
  class Range extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      src.read(begin, end).then((b) => this.onDataRange(begin, b), fail);
    }
  }
  const first = await src.read(0, Math.min(src.chunk, src.size));
  const task = pdfjs.getDocument({
    range: new Range(src.size, first),
    rangeChunkSize: src.chunk,
    disableAutoFetch: true, // never pre-fetch the rest of the file
    disableStream: true,
  });
  const doc = await Promise.race([task.promise, failed]);
  /** pdf.js waits forever for a range that never arrives: a failed read ends the wait instead. */
  const guard = <T,>(p: Promise<T>) => Promise.race([p, failed]);
  return { doc, task, guard };
}

/** Page count and printed page labels (as the PDF stores them: one string per page, or null) without rendering anything. */
export async function readPdfMeta(file: File): Promise<{ pageCount: number; labels: string[] | null }> {
  const { doc, task } = await openDocument(fileSource(file));
  try {
    return { pageCount: doc.numPages, labels: await doc.getPageLabels() };
  } finally {
    await task.destroy();
  }
}

async function open(src: Source): Promise<OpenPdf> {
  const { doc, task, guard } = await openDocument(src);

  return {
    pageCount: doc.numPages,
    async render(n, maxWidth = MAX_W) {
      const page = await guard(doc.getPage(n));
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(maxWidth / base.width, 2.5) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await guard(page.render({ canvasContext: ctx, canvas, viewport }).promise);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", QUALITY));
        canvas.width = canvas.height = 0; // release the pixel buffer
        if (!blob || blob.type !== "image/webp") throw new Error("webp encoding unsupported");
        return blob;
      } finally {
        page.cleanup(); // release this page's operator list / images before the next page
      }
    },
    async text(n) {
      const page = await guard(doc.getPage(n));
      try {
        const v = page.getViewport({ scale: 1 });
        const content = await guard(page.getTextContent());
        return itemsFromRuns(runsFromPdf(content, v.transform, v.scale), v.width, v.height);
      } finally {
        page.cleanup();
      }
    },
    destroy: () => task.destroy(),
  };
}

export const openPdf = (file: File) => open(fileSource(file));
/** The stored original of a book (`size` bytes), read with Range requests through presigned URLs. */
export const openPdfUrl = (size: number, getUrl: () => Promise<string>) => open(urlSource(size, getUrl));
