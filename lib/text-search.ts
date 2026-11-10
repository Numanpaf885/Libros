// Searching a book's text (the stored chunks, lib/text-layer.ts). Pure: each page becomes one string in reading order
// (body text, then the margin; rotated text left out), with a hyphen at a line end joined to the next line, and matches
// ignore case, accents and ligatures ("aerodinamica" finds "AERODINÁMICA"). A match gives its page, a short snippet and the boxes
// of the words it covers, to highlight them over the page image.
import { textWidth } from "./glyph-widths";
import { isRotated, pageLayout, type TextItem } from "./text-layer";

export interface Box { x: number; y: number; w: number; h: number }
export interface PageHit { page: number; count: number; boxes: Box[]; snippet?: { text: string; start: number; end: number } }
export interface SearchResult { total: number; pages: PageHit[]; truncated: boolean }

interface Span { from: number; to: number; item: TextItem }
interface PageIndex { n: number; text: string; norm: string; map: number[]; spans: Span[] }

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
const MAX_PAGES = 200;
const MAX_BOXES = 60;
const SNIPPET = 60;
const DEFAULT_RATIO = 1.414;

/** Lowercase, accents removed, whitespace collapsed; `map[i]` is the index in `s` that norm[i] came from. */
export function normalize(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const base = s[i].normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    if (/\s/.test(base)) { if (!space && norm) { norm += " "; map.push(i); } space = true; continue; }
    space = false;
    for (const ch of base) { norm += ch; map.push(i); }
  }
  if (norm.endsWith(" ")) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}
export const normalizeQuery = (q: string) => normalize(q.slice(0, MAX_QUERY)).norm;

/** One page's text in reading order, with where each item is in it. */
export function indexPage(n: number, items: readonly TextItem[], ratio = DEFAULT_RATIO): PageIndex {
  const layout = pageLayout(items, ratio);
  let text = "";
  const spans: Span[] = [];
  for (const i of layout.order) {
    const it = items[i];
    if (isRotated(it)) continue;
    if (text) {
      // "velo-" + "cidad" -> "velocidad"; everything else is separated by a space
      if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(it.s)) text = text.slice(0, -1);
      else text += " ";
    }
    spans.push({ from: text.length, to: text.length + it.s.length, item: it });
    text += it.s;
  }
  const { norm, map } = normalize(text);
  return { n, text, norm, map, spans };
}

/**
 * The boxes of the text between `from` and `to` (indexes in the page's text): the covered part of each item, measured
 * with glyph widths (a capital is wider than an "i"), as the reader's text layer stretches its text.
 */
function boxesOf(p: PageIndex, from: number, to: number): Box[] {
  const out: Box[] = [];
  for (const s of p.spans) {
    if (s.to <= from || s.from >= to) continue;
    const a = Math.max(from, s.from) - s.from, b = Math.min(to, s.to) - s.from;
    const it = s.item, all = textWidth(it.s) || 1;
    const x0 = textWidth(it.s.slice(0, a)) / all, x1 = textWidth(it.s.slice(0, b)) / all;
    out.push({ x: it.x + it.w * x0, y: it.y, w: Math.max(it.w * (x1 - x0), 0.002), h: it.h });
  }
  return out;
}

/** A short piece of the page around a match, cut at word boundaries, and where the match is in it. */
function snippetOf(text: string, from: number, to: number) {
  let a = Math.max(0, from - SNIPPET), b = Math.min(text.length, to + SNIPPET);
  if (a > 0) { const sp = text.indexOf(" ", a); if (sp >= 0 && sp < from) a = sp + 1; }
  if (b < text.length) { const sp = text.lastIndexOf(" ", b); if (sp > to) b = sp; }
  const pre = a > 0 ? "…" : "", post = b < text.length ? "…" : "";
  return { text: pre + text.slice(a, b) + post, start: pre.length + from - a, end: pre.length + to - a };
}

/**
 * Every match of `query` in the pages, in page order: per page the number of matches, their boxes and (when `snippets`)
 * a snippet around the first one. At most MAX_PAGES pages are returned (`truncated` says there were more).
 */
export function searchPages(pages: readonly PageIndex[], query: string, snippets: boolean): SearchResult {
  const q = normalizeQuery(query);
  const out: PageHit[] = [];
  let total = 0, truncated = false;
  if (q.length < MIN_QUERY) return { total, pages: out, truncated };
  for (const p of pages) {
    let at = p.norm.indexOf(q), count = 0;
    const boxes: Box[] = [];
    let first: [number, number] | null = null;
    while (at >= 0) {
      const from = p.map[at], to = p.map[at + q.length - 1] + 1;
      if (!first) first = [from, to];
      if (boxes.length < MAX_BOXES) boxes.push(...boxesOf(p, from, to));
      count++;
      at = p.norm.indexOf(q, at + q.length);
    }
    if (!count) continue;
    total += count;
    if (out.length >= MAX_PAGES) { truncated = true; continue; }
    const hit: PageHit = { page: p.n, count, boxes: boxes.slice(0, MAX_BOXES) };
    if (snippets && first) hit.snippet = snippetOf(p.text, first[0], first[1]);
    out.push(hit);
  }
  return { total, pages: out, truncated };
}
