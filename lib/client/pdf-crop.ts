"use client";
// Cuts a page range out of the ORIGINAL PDF in the browser: fetches it (with progress), then pdf-lib copies the chosen pages
// into a new document. Text, fonts and links of those pages stay as they are. pdf-lib is loaded only when this runs.

/** Downloads `url` into memory with progress. `size` is the expected length when the server does not send one. */
export async function fetchWithProgress(url: string, size: number, signal: AbortSignal, onProgress: (done: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok || !res.body) throw new Error(`original ${res.status}`);
  const total = Number(res.headers.get("content-length")) || size;
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new Error("original too long");
    out.set(value, at);
    at += value.length;
    onProgress(at, total);
  }
  if (at !== total) throw new Error("original incomplete");
  return out;
}

/** Pages `from`..`to` (1-based, inclusive) of a PDF as a new PDF. */
export async function cropPdf(bytes: Uint8Array, from: number, to: number): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  for (const p of pages) out.addPage(p);
  const saved = await out.save({ useObjectStreams: true });
  return new Blob([saved as BlobPart], { type: "application/pdf" });
}
