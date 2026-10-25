"use client";
// Reader: the text of the pages for the selectable layer. One chunk of 20 pages at a time through the cookie-checked
// route (a fresh 60 s presigned URL each time), checked before use, and kept only for the chunks near the current page.
// Also the copy rules: only text selected inside a text layer is copied, as plain text with sensible line breaks.
import { chunkOf, joinPieces, parseChunk, TEXT_CHUNK, type PageText, type Piece, type TextItem } from "@/lib/text-layer";

const MAX_CHUNKS = 6;
type Chunk = Map<number, PageText> | null;
const pending = new Map<string, Promise<Chunk>>();
const done = new Map<string, Chunk>();

async function fetchChunk(slug: string, k: number): Promise<Chunk> {
  const meta = await fetch(`/api/books/${encodeURIComponent(slug)}/text/${k}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (meta.status >= 500) throw new Error("text unavailable"); // the service is down for a moment: not remembered, asked again
  if (!meta.ok) return null; // no text for these pages (404), or the access has ended (the pages report that one)
  const { url } = (await meta.json()) as { url: string };
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  return parseChunk(await res.json().catch(() => null), k * TEXT_CHUNK + 1, (k + 1) * TEXT_CHUNK);
}

/** The text items of page n, or null when the page has no text. One request per chunk, shared by its 20 pages. */
export function loadPageText(slug: string, n: number): Promise<TextItem[] | null> {
  const key = `${slug}:${chunkOf(n)}`;
  const hit = done.get(key);
  if (hit !== undefined) return Promise.resolve(hit?.get(n)?.items ?? null);
  let p = pending.get(key);
  if (!p) {
    const job = fetchChunk(slug, chunkOf(n)).catch(() => undefined);
    p = job.then((c) => {
      pending.delete(key);
      if (c !== undefined) { // a network failure is not remembered: the next page asks again
        done.set(key, c);
        while (done.size > MAX_CHUNKS) done.delete(done.keys().next().value as string);
      }
      return c ?? null;
    });
    pending.set(key, p);
  }
  return p.then((c) => c?.get(n)?.items ?? null);
}
/** The items of page n if its chunk is already here (undefined: not loaded yet). Never starts a request. */
export function peekPageText(slug: string, n: number): TextItem[] | null | undefined {
  const c = done.get(`${slug}:${chunkOf(n)}`);
  return c === undefined ? undefined : c?.get(n)?.items ?? null;
}

let hold: () => boolean = () => false;
/** The book reader says when a page turns: text layers then wait, so nothing is laid out in the middle of a turn. */
export function holdText(f: () => boolean) { hold = f; }
export function afterTurn(fn: () => void) {
  if (hold()) setTimeout(() => afterTurn(fn), 120);
  else fn();
}

// ---- selection and copy ----
interface Layer { page: number; items: readonly TextItem[]; ratio: number }
const layers = new Map<Element, Layer>();
/** A text layer on screen (its spans carry data-i = the item index). Returns the function that removes it. */
export function registerLayer(el: Element, info: Layer) {
  layers.set(el, info);
  return () => { if (layers.get(el) === info) layers.delete(el); };
}
export const inTextLayer = (node: Node | null) => !!(node && (node instanceof Element ? node : node.parentElement)?.closest(".text-layer"));
/** There is a selection, and it is inside a text layer. */
export function hasTextSelection(): boolean {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  return !!sel && !sel.isCollapsed && inTextLayer(sel.anchorNode);
}

/** The selected text of the text layers as plain text, or null when nothing in a text layer is selected. */
export function selectedText(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const pieces: Piece[] = [];
  const info = new Map<number, Layer>();
  const els = [...document.querySelectorAll(".text-layer")].filter((el) => layers.has(el));
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r);
    for (const el of els) {
      if (!range.intersectsNode(el)) continue;
      const layer = layers.get(el)!;
      info.set(layer.page, layer);
      for (const span of el.querySelectorAll<HTMLElement>("span[data-i]")) {
        const t = span.firstChild;
        if (!(t instanceof Text) || !range.intersectsNode(t)) continue;
        // the part of this text node inside the range: from its start (or where the range starts in it) to its end (or where the range ends)
        const from = range.comparePoint(t, 0) >= 0 ? 0 : range.startContainer === t ? range.startOffset : t.length;
        const to = range.comparePoint(t, t.length) <= 0 ? t.length : range.endContainer === t ? range.endOffset : 0;
        if (to > from) pieces.push({ page: layer.page, i: Number(span.dataset.i), text: t.data.slice(from, to) });
      }
    }
  }
  if (!pieces.length) return null;
  return joinPieces(pieces, (p) => info.get(p)?.items ?? [], (p) => info.get(p)?.ratio ?? 1.414);
}
