// The book's text as an invisible layer in a downloaded PDF (text render mode 3), over the page image, so the file can
// be searched and its text copied in any PDF viewer. Standard Helvetica with WinAnsi (Windows-1252) encoding: nothing is
// embedded, and every Spanish character is covered; anything else is simplified ("ő" -> "o") or left as "?". Each
// item is stretched (Tz) to the width it has on the page, so a viewer's highlight sits over the printed words.
import { HELVETICA_WIDTHS as W, winAnsiCode as one } from "@/lib/glyph-widths";
import type { TextItem } from "@/lib/text-layer";

const ALSO: Record<string, string> = { "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2212": "-", "\u2044": "/" };

/** WinAnsi codes for a string: as close as WinAnsi gets. */
export function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const c = one(cp);
    if (c !== null) { out.push(c); continue; }
    if (/\s/.test(ch)) { out.push(32); continue; }
    if (ALSO[ch]) { out.push(ALSO[ch].charCodeAt(0)); continue; }
    const simple = [...ch.normalize("NFKD").replace(/\p{M}/gu, "")].map((x) => one(x.codePointAt(0)!));
    if (simple.length && simple.every((x) => x !== null)) out.push(...(simple as number[]));
    else out.push(63); // "?"
  }
  return out;
}
const widthOf = (codes: readonly number[]) => codes.reduce((s, c) => s + (W[c - 32] ?? 556), 0) / 1000;

/** Where a page's items go: a page box in user space (points) and its rotation, as pdf.js shows it (the item fractions). */
export interface Frame { x0: number; y0: number; x1: number; y1: number; rotate: 0 | 90 | 180 | 270 }
/** One item, ready to write: its codes, font size, horizontal scaling (%) and text matrix. */
export interface Placed { codes: number[]; size: number; tz: number; m: [number, number, number, number, number, number] }

const BASELINE = 0.78; // where the baseline sits in an item's box, as a fraction of its height

/** Device fractions (as on screen, y down) -> user space of the page. */
function toUser(f: Frame, fx: number, fy: number): [number, number] {
  const wb = f.x1 - f.x0, hb = f.y1 - f.y0;
  switch (f.rotate) {
    case 90: return [f.x0 + fy * wb, f.y0 + fx * hb];
    case 180: return [f.x1 - fx * wb, f.y0 + fy * hb];
    case 270: return [f.x1 - fy * wb, f.y1 - fx * hb];
    default: return [f.x0 + fx * wb, f.y1 - fy * hb];
  }
}

/** The page's items placed in user space. Items without width or with nothing to write are left out. */
export function placeItems(items: readonly TextItem[], f: Frame): Placed[] {
  const side = f.rotate === 90 || f.rotate === 270;
  const devW = side ? f.y1 - f.y0 : f.x1 - f.x0, devH = side ? f.x1 - f.x0 : f.y1 - f.y0;
  const out: Placed[] = [];
  for (const it of items) {
    const codes = winAnsi(it.s);
    const size = it.h * devH, length = it.w * devW;
    const natural = widthOf(codes) * size;
    if (!codes.length || !(size > 0) || !(natural > 0) || !(length > 0)) continue;
    const r = ((it.r ?? 0) * Math.PI) / 180;
    // the baseline's start on the screen (y down), then in user space; the angle turns with the page
    const bx = it.x * devW + Math.sin(r) * BASELINE * size, by = it.y * devH + Math.cos(r) * BASELINE * size;
    const [X, Y] = toUser(f, bx / devW, by / devH);
    const a = (((it.r ?? 0) + f.rotate) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    out.push({ codes, size, tz: Math.min(2000, Math.max(1, (100 * length) / natural)), m: [c, s, -s, c, X, Y] });
  }
  return out;
}

const n4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
/** A PDF string literal of WinAnsi codes, ASCII only (octal escapes for the rest). */
function literal(codes: readonly number[]): string {
  let s = "(";
  for (const c of codes) s += c < 32 || c > 126 || c === 40 || c === 41 || c === 92 ? `\\${c.toString(8).padStart(3, "0")}` : String.fromCharCode(c);
  return `${s})`;
}
/** The content-stream operators that write the placed items invisibly with font resource `font` (e.g. "F1"). ASCII. */
export function textStream(placed: readonly Placed[], font: string): string {
  if (!placed.length) return "";
  const parts = ["BT 3 Tr"];
  for (const p of placed) parts.push(`/${font} ${n4(p.size)} Tf ${n4(p.tz)} Tz ${p.m.map(n4).join(" ")} Tm ${literal(p.codes)} Tj`);
  parts.push("ET");
  return parts.join("\n");
}
