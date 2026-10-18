"use client";
// Page images: ask the server for a 60 s presigned URL (cookie-checked), fetch the bytes as a
// blob, decode into an ImageBitmap for canvas drawing (never an <img>). The URL is requested right
// before the fetch and discarded after it, so an expired one is never reused.
const MAX_CACHED = 24; // safety net; the book reader trims explicitly to the pages near the current one

interface Entry { p: Promise<ImageBitmap>; bmp?: ImageBitmap }
const cache = new Map<string, Entry>();

export class Unauthorized extends Error {}

async function fetchOnce(slug: string, n: number): Promise<ImageBitmap> {
  const meta = await fetch(`/api/books/${encodeURIComponent(slug)}/pages/${n}`, { cache: "no-store" });
  if (meta.status === 401) throw new Unauthorized();
  if (!meta.ok) throw new Error("page failed");
  const { url } = (await meta.json()) as { url: string };
  const img = await fetch(url, { cache: "no-store" });
  if (!img.ok) throw new Error("page failed");
  return createImageBitmap(await img.blob()); // decoded here, before the page can be shown
}
async function fetchPage(slug: string, n: number): Promise<ImageBitmap> {
  try {
    return await fetchOnce(slug, n);
  } catch (e) {
    if (e instanceof Unauthorized) throw e;
    return fetchOnce(slug, n); // one retry with a fresh presigned URL
  }
}

function drop(key: string) {
  const e = cache.get(key);
  cache.delete(key);
  e?.p.then((b) => b.close()).catch(() => {});
}

export function loadPage(slug: string, n: number): Promise<ImageBitmap> {
  const key = `${slug}:${n}`;
  let e = cache.get(key);
  if (!e) {
    const entry: Entry = { p: fetchPage(slug, n) };
    e = entry;
    cache.set(key, entry);
    entry.p.then((b) => { entry.bmp = b; }, () => { if (cache.get(key) === entry) cache.delete(key); });
    while (cache.size > MAX_CACHED) drop(cache.keys().next().value as string);
  }
  return e.p;
}

/** The decoded page if it is already in the cache, else undefined. Never starts a request. */
export function peekPage(slug: string, n: number): ImageBitmap | undefined {
  return cache.get(`${slug}:${n}`)?.bmp;
}

/** Warm the cache. */
export function prefetch(slug: string, pages: number[], pageCount: number) {
  for (const n of pages) if (n >= 1 && n <= pageCount) loadPage(slug, n).catch(() => {});
}

/** Frees decoded pages of this book that `keep` rejects. */
export function trimPages(slug: string, keep: (n: number) => boolean) {
  const prefix = `${slug}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix) && !keep(Number(key.slice(prefix.length)))) drop(key);
  }
}

/** Draws the decoded page onto its canvas at native resolution (CSS scales it). */
export function drawPage(canvas: HTMLCanvasElement, bmp: ImageBitmap) {
  if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
    canvas.width = bmp.width;
    canvas.height = bmp.height;
  }
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
}
