"use client";
// Reader: the text of the pages for the selectable layer. One chunk of 20 pages at a time through the cookie-checked
// route (a fresh 60 s presigned URL each time), checked before use, and kept only for the chunks near the current page.
// Also the copy rules: only text selected inside a text layer is copied, as plain text with sensible line breaks.
import { chunkOf, joinPieces, MARGIN, parseChunk, ROTATED, TEXT_CHUNK, type Layout, type PageText, type Piece, type TextItem } from "@/lib/text-layer";

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
interface Layer { page: number; items: readonly TextItem[]; ratio: number; layout: Layout; end: HTMLElement }
const layers = new Map<Element, Layer>();

// While a drag selects, a layer is marked data-selecting and its .tl-end (globals.css) covers the layer under the text,
// so empty space (and margin text, which then lets the pointer through) never makes the selection jump to the start or
// the end of the layer. Firefox and Chromium 148+ need nothing more; other browsers also need .tl-end moved right next
// to the end of the selection being dragged. This is pdf.js's text layer logic (TextLayerBuilder).
let pointerIsDown = false;
let prevRange: Range | null = null;
let modern: boolean | undefined;
const setSelect = (el: HTMLElement, v: string) => { el.style.userSelect = v; el.style.setProperty("-webkit-user-select", v); };
function reset(el: Element, info: Layer) {
  if (el.lastChild !== info.end) el.appendChild(info.end);
  setSelect(info.end, "");
  el.removeAttribute("data-selecting");
}
const resetAll = () => { for (const [el, info] of layers) reset(el, info); };
function isModern(el: Element) {
  if (getComputedStyle(el).getPropertyValue("-moz-user-select") === "none") return true; // Firefox
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands;
  const v = brands ? brands.find((b) => b.brand === "Chromium")?.version : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!v && parseInt(v, 10) >= 148;
}
/**
 * Pointer down: a drag that starts on margin text (a running header, a footer) may select it and stays in the margin;
 * any other drag leaves the margin alone (globals.css reads data-sel). Set before the browser starts the selection.
 */
function onPointerDown(e: PointerEvent) {
  pointerIsDown = true;
  const target = e.target instanceof Element ? e.target : null;
  const here = target?.closest(".text-layer") ?? null;
  const margin = here && target?.closest(".text-margin") ? here : null;
  for (const el of layers.keys()) {
    if (el === margin) el.setAttribute("data-sel", "margin");
    else el.removeAttribute("data-sel");
    if (el === here) el.setAttribute("data-selecting", "");
  }
}
/** After the browser has handled the release (it may place the selection's end once more where the pointer is). */
function onPointerUp() { pointerIsDown = false; setTimeout(() => { if (!pointerIsDown) resetAll(); }, 0); }
function onKeyUp() { if (!pointerIsDown) resetAll(); }
function onSelectionChange() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) { resetAll(); return; }
  const active = new Set<Element>();
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    for (const el of layers.keys()) if (!active.has(el) && range.intersectsNode(el)) active.add(el);
  }
  for (const [el, info] of layers) {
    if (active.has(el)) el.setAttribute("data-selecting", "");
    else reset(el, info);
  }
  const first = layers.keys().next().value;
  if (!first) return;
  modern ??= isModern(first);
  if (modern) return;
  const range = sel.getRangeAt(0);
  const modifyStart = !!prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  // a selection that ends at the very start of a span: the end goes after the previous span. Not for the caret a drag
  // starts from (pdf.js does it then too): the drag usually goes forwards, and would otherwise select nothing
  if (!modifyStart && range.endOffset === 0 && !range.collapsed) {
    do {
      while (anchor && !anchor.previousSibling && !(anchor instanceof Element && anchor.classList.contains("text-layer"))) anchor = anchor.parentNode;
      anchor = anchor?.previousSibling ?? null;
    } while (anchor && !anchor.childNodes.length);
  }
  const layerEl = anchor?.parentElement?.closest(".text-layer");
  const info = layerEl ? layers.get(layerEl) : undefined;
  if (info && anchor && anchor !== info.end && anchor.parentElement) {
    setSelect(info.end, "text");
    anchor.parentElement.insertBefore(info.end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}
/** The document-wide listeners while any layer is on screen (a function: there is no document on the server). */
const listeners = (): [EventTarget, string, EventListener, boolean][] => [
  [document, "pointerdown", onPointerDown as EventListener, true],
  [document, "pointerup", onPointerUp, true],
  [document, "pointercancel", onPointerUp, true],
  [document, "keyup", onKeyUp, false],
  [document, "selectionchange", onSelectionChange, false],
  [window, "blur", onPointerUp, false],
];
/** A text layer on screen (its spans carry data-i = the item index). Returns the function that removes it. */
export function registerLayer(el: Element, info: Omit<Layer, "end">) {
  if (!layers.size) for (const [t, type, fn, capture] of listeners()) t.addEventListener(type, fn, capture);
  const end = document.createElement("div");
  end.className = "tl-end";
  el.appendChild(end);
  const full: Layer = { ...info, end };
  layers.set(el, full);
  return () => {
    end.remove();
    if (layers.get(el) !== full) return;
    layers.delete(el);
    if (!layers.size) {
      for (const [t, type, fn, capture] of listeners()) t.removeEventListener(type, fn, capture);
      prevRange = null;
    }
  };
}
export const inTextLayer = (node: Node | null) => !!(node && (node instanceof Element ? node : node.parentElement)?.closest(".text-layer"));
/** There is a selection, and it is inside a text layer. */
export function hasTextSelection(): boolean {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  return !!sel && !sel.isCollapsed && inTextLayer(sel.anchorNode);
}

/**
 * The selected text of the text layers as plain text, or null when nothing in a text layer is selected. Pieces are put
 * in reading order (page by page, then the layer's order). Rotated text is never copied, and margin text only when
 * the selection started on margin text (then the body is left out): even if the range runs past the end of the body.
 */
export function selectedText(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const start = sel.anchorNode;
  const fromMargin = !!(start && (start instanceof Element ? start : start.parentElement)?.closest(".text-margin"));
  const pieces: (Piece & { rank: number })[] = [];
  const info = new Map<number, Layer>();
  const els = [...document.querySelectorAll(".text-layer")].filter((el) => layers.has(el));
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r);
    for (const el of els) {
      if (!range.intersectsNode(el)) continue;
      const layer = layers.get(el)!;
      info.set(layer.page, layer);
      for (const span of el.querySelectorAll<HTMLElement>("span[data-i]")) {
        const t = span.firstChild, i = Number(span.dataset.i);
        const kind = layer.layout.kind[i];
        if (!(t instanceof Text) || kind === ROTATED || (kind === MARGIN) !== fromMargin || !range.intersectsNode(t)) continue;
        // the part of this text node inside the range: from its start (or where the range starts in it) to its end (or where the range ends)
        const from = range.comparePoint(t, 0) >= 0 ? 0 : range.startContainer === t ? range.startOffset : t.length;
        const to = range.comparePoint(t, t.length) <= 0 ? t.length : range.endContainer === t ? range.endOffset : 0;
        if (to > from) pieces.push({ page: layer.page, i, text: t.data.slice(from, to), rank: layer.layout.rank[i] });
      }
    }
  }
  if (!pieces.length) return null;
  pieces.sort((a, b) => a.page - b.page || a.rank - b.rank);
  return joinPieces(pieces, (p) => info.get(p)?.items ?? [], (p) => info.get(p)?.ratio ?? 1.414);
}
