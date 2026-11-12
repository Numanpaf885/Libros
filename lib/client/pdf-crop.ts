"use client";
// Cuts a page range out of the ORIGINAL PDF in the browser: fetches it (with progress), then pdf-lib copies the chosen pages
// into a new document. Text, fonts and links of those pages stay as they are; pages whose text was recognised by OCR
// (the original has none) get it as an invisible layer. pdf-lib is loaded only when this runs.
import type { TextItem } from "@/lib/text-layer";
import { placeItems } from "./pdf-text";

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

/**
 * Pages `from`..`to` (1-based, inclusive) of a PDF as a new PDF. `ocrText(page)`: the recognised text to add to a page
 * (null for pages that need none: their text is in the PDF already).
 */
export async function cropPdf(bytes: Uint8Array, from: number, to: number, ocrText?: (page: number) => Promise<TextItem[] | null>): Promise<Blob> {
  const lib = await import("pdf-lib");
  const { PDFDocument, PDFHexString, StandardFonts, TextRenderingMode } = lib;
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  let font: Awaited<ReturnType<typeof out.embedFont>> | null = null;
  for (const [i, p] of pages.entries()) {
    out.addPage(p);
    const items = ocrText ? await ocrText(from + i) : null;
    if (!items?.length) continue;
    font ??= await out.embedFont(StandardFonts.Helvetica); // standard Helvetica, WinAnsi: nothing is embedded
    const box = p.getCropBox();
    const rotate = ((((p.getRotation().angle % 360) + 360) % 360) / 90) * 90 as 0 | 90 | 180 | 270;
    const placed = placeItems(items, { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height, rotate });
    if (!placed.length) continue;
    const key = p.node.newFontDictionary("FOcr", font.ref);
    const hex = (codes: number[]) => PDFHexString.of(codes.map((c) => c.toString(16).padStart(2, "0")).join(""));
    p.pushOperators(
      lib.pushGraphicsState(), lib.beginText(), lib.setTextRenderingMode(TextRenderingMode.Invisible),
      ...placed.flatMap((x) => [lib.setFontAndSize(key, x.size), lib.setCharacterSqueeze(x.tz), lib.setTextMatrix(...x.m), lib.showText(hex(x.codes))]),
      lib.endText(), lib.popGraphicsState(),
    );
  }
  const saved = await out.save({ useObjectStreams: true });
  return new Blob([saved as BlobPart], { type: "application/pdf" });
}
