"use client";
// Book mode draws every page ONCE, at its on-screen size, into a canvas that is kept (a "face"). When a
// turn starts the same canvas nodes are moved into the turning layers, so nothing is drawn or decoded
// on the critical path of the animation. Faces exist only for pages already decoded in the page cache.
import { peekPage } from "./pages";

const faces = new Map<string, HTMLCanvasElement>();
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
// Canvas size: device pixel ratio at most 2 and the longest side at most 2048 px.
const size = (w: number, h: number) => {
  const k = Math.min(dpr(), 2048 / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))] as const;
};
const keyOf = (slug: string, n: number, cw: number, ch: number) => `${slug}:${n}:${cw}x${ch}`;

/** The page's canvas at w x h CSS pixels, drawn now if it is not cached yet. null while the page is not decoded. */
export function getFace(slug: string, n: number, w: number, h: number): HTMLCanvasElement | null {
  const [cw, ch] = size(w, h);
  const key = keyOf(slug, n, cw, ch);
  const hit = faces.get(key);
  if (hit) return hit;
  const bmp = peekPage(slug, n);
  if (!bmp) return null;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  c.setAttribute("aria-label", `Página ${n}`);
  c.style.cssText = "display:block;width:100%;height:100%";
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    const k = Math.min(cw / bmp.width, ch / bmp.height);
    const dw = bmp.width * k, dh = bmp.height * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }
  faces.set(key, c);
  return c;
}

let hold: () => boolean = () => false;
/** The reader tells us when a page turn is running: background drawing then waits for it to end. */
export function holdFaces(f: () => boolean) { hold = f; }

/** Draw a face when the browser is idle (never during an animation frame, never while a page turns). */
export function prepareFace(slug: string, n: number, w: number, h: number) {
  const run = () => { if (hold()) { setTimeout(run, 120); return; } getFace(slug, n, w, h); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 150 }); else setTimeout(run, 30);
}

/** Drop this book's faces that are not wanted any more (other pages, or another size). */
export function trimFaces(slug: string, keep: (n: number) => boolean, w: number, h: number) {
  const [cw, ch] = size(w, h);
  const want = `:${cw}x${ch}`;
  for (const key of [...faces.keys()]) {
    if (!key.startsWith(`${slug}:`)) continue;
    const parts = key.split(":");
    if (!key.endsWith(want) || !keep(Number(parts[1]))) faces.delete(key);
  }
}
