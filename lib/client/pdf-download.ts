// Builds a PDF of a page range in the browser: fetch each page (4 at a time), draw it on a canvas, export a JPEG and feed
// the streaming writer. Memory stays small: only a few pages are in flight and each page's bitmap and canvas are released
// as soon as its JPEG exists.
import { PdfWriter } from "./pdf-writer";

export const PARALLEL = 4;
const BATCH = 20; // page URLs requested per call
const JPEG_QUALITY = 0.85;

export type PageUrls = (pages: number[]) => Promise<{ page: number; url: string }[]>;
export interface BuildOptions {
  from: number;
  to: number;
  urls: PageUrls;
  signal: AbortSignal;
  /** called after each page is written: (pages done, total) */
  onProgress: (done: number, total: number) => void;
}

/** Hands out page URLs: 20 at a time (aligned to the first page of the range), one request per batch. */
class UrlBook {
  private known = new Map<number, string>();
  private asking = new Map<string, Promise<void>>();
  constructor(private fetchUrls: PageUrls, private from: number, private to: number) {}
  private ask(first: number, count: number): Promise<void> {
    const key = `${first}:${count}`;
    let p = this.asking.get(key);
    if (!p) {
      const pages = Array.from({ length: count }, (_, i) => first + i);
      p = this.fetchUrls(pages).then((r) => { for (const u of r) this.known.set(u.page, u.url); }).finally(() => this.asking.delete(key));
      this.asking.set(key, p);
    }
    return p;
  }
  async get(page: number, fresh = false): Promise<string> {
    if (fresh) {
      this.known.delete(page);
      await this.ask(page, 1);
    } else if (!this.known.has(page)) {
      const first = this.from + Math.floor((page - this.from) / BATCH) * BATCH;
      await this.ask(first, Math.min(BATCH, this.to - first + 1));
    }
    const url = this.known.get(page);
    if (!url) throw new Error("no url");
    return url;
  }
}

async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`page ${res.status}`);
  return res.blob();
}

/** One page: fetched, decoded, drawn on a white canvas and exported as a JPEG. */
async function pageToJpeg(urls: UrlBook, page: number, signal: AbortSignal): Promise<{ jpeg: Blob; w: number; h: number }> {
  let blob: Blob;
  try {
    blob = await fetchBlob(await urls.get(page), signal);
  } catch (e) {
    if (signal.aborted) throw e;
    blob = await fetchBlob(await urls.get(page, true), signal); // the URL may have expired: one retry with a fresh one
  }
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    const out = { w: canvas.width, h: canvas.height };
    canvas.width = canvas.height = 0; // release the pixel buffer
    if (!jpeg) throw new Error("jpeg encoding failed");
    return { jpeg, ...out };
  } finally {
    bmp.close();
  }
}

/** Builds the PDF. Rejects with the signal's reason when cancelled. */
export async function buildPdf(o: BuildOptions): Promise<Blob> {
  const total = o.to - o.from + 1;
  const book = new UrlBook(o.urls, o.from, o.to);
  const writer = new PdfWriter();
  const inflight = new Map<number, Promise<{ jpeg: Blob; w: number; h: number }>>();
  const launch = (page: number) => {
    const p = pageToJpeg(book, page, o.signal);
    p.catch(() => {}); // a failure is reported when its turn comes
    inflight.set(page, p);
  };
  o.onProgress(0, total);
  for (let page = o.from; page <= o.to; page++) {
    o.signal.throwIfAborted();
    for (let k = page; k < page + PARALLEL && k <= o.to; k++) if (!inflight.has(k)) launch(k);
    const r = await inflight.get(page)!;
    inflight.delete(page);
    writer.addJpeg(r.jpeg, r.w, r.h);
    o.onProgress(page - o.from + 1, total);
  }
  o.signal.throwIfAborted();
  return writer.finish();
}

/** Starts the browser's download of a file. The object URL is released afterwards. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Starts the browser's download of a URL the server answers with "Content-Disposition: attachment" (nothing is held in memory). */
export function saveUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
