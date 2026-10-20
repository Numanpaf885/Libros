"use client";

const MAX_W = 1400;
export const COVER_W = 480;
const QUALITY = 0.8;
/** Largest single read from the local file. pdf.js may ask for a longer range; we assemble it from reads this size. */
const READ_CHUNK = 64 * 1024;

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
  destroy(): Promise<void>;
}

/**
 * Opens a local PDF WITHOUT reading it all into memory: pdf.js asks for byte ranges and we
 * answer each one with File.slice(). An 800 MB file therefore costs only what pages need.
 */
export async function openPdf(file: File): Promise<OpenPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  class FileRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      readRange(file, begin, Math.min(end, file.size)).then((b) => this.onDataRange(begin, b));
    }
  }
  const first = await readRange(file, 0, Math.min(READ_CHUNK, file.size));
  const task = pdfjs.getDocument({
    range: new FileRange(file.size, first),
    rangeChunkSize: READ_CHUNK,
    disableAutoFetch: true, // never pre-fetch the rest of the file
    disableStream: true,
  });
  const doc = await task.promise;

  return {
    pageCount: doc.numPages,
    async render(n, maxWidth = MAX_W) {
      const page = await doc.getPage(n);
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
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", QUALITY));
        canvas.width = canvas.height = 0; // release the pixel buffer
        if (!blob || blob.type !== "image/webp") throw new Error("webp encoding unsupported");
        return blob;
      } finally {
        page.cleanup(); // release this page's operator list / images before the next page
      }
    },
    destroy: () => task.destroy(),
  };
}
