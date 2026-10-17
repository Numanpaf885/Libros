"use client";
// Page images: ask the server for a 60 s presigned URL (cookie-checked), fetch the bytes as a
// blob, decode for canvas drawing (never an <img>). The URL is discarded right after use.
const MAX_CACHED = 6; // visible window + a couple prefetched
const cache = new Map<string, Promise<ImageBitmap>>();

export class Unauthorized extends Error {}

async function fetchPage(slug: string, n: number): Promise<ImageBitmap> {
  const meta = await fetch(`/api/books/${encodeURIComponent(slug)}/pages/${n}`, { cache: "no-store" });
  if (meta.status === 401) throw new Unauthorized();
  if (!meta.ok) throw new Error("page failed");
  const { url } = (await meta.json()) as { url: string };
  const img = await fetch(url, { cache: "no-store" });
  if (!img.ok) throw new Error("page failed");
  return createImageBitmap(await img.blob());
}

export function loadPage(slug: string, n: number): Promise<ImageBitmap> {
  const key = `${slug}:${n}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchPage(slug, n);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    while (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value as string;
      cache.get(oldest)?.then((b) => b.close()).catch(() => {});
      cache.delete(oldest);
    }
  }
  return p;
}

/** Warm the cache for the next pages (reader calls this with the next 2 only). */
export function prefetch(slug: string, pages: number[], pageCount: number) {
  for (const n of pages) if (n >= 1 && n <= pageCount) loadPage(slug, n).catch(() => {});
}

/** Draws the decoded page onto its canvas at native resolution (CSS scales it). */
export function drawPage(canvas: HTMLCanvasElement, bmp: ImageBitmap) {
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
}
