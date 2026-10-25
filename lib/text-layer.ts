// The selectable text of a book's pages: the stored format, the chunking and the pure helpers shared by the admin
// (extraction, OCR) and the reader (text layer, copy). No pdf.js and nothing server-only here.
//
// Stored in R2 as JSON chunks of TEXT_CHUNK pages: {prefix}/text/0001-0020.json, 0021-0040.json, ... Each chunk is
// { v: 1, pages: [{ n, src, ver?, items }] } with only the pages that have been processed. Fields added later are
// optional, so chunks stored before them still load: an item without r is horizontal, a page without ver is version 1.

/**
 * One run of text on a page. x, y (top), w, h are fractions of the page width / height; size is the font size as a
 * fraction of the page height. r: the angle of the text in degrees, counter-clockwise as printed (90 = it reads
 * upwards); missing means 0. For rotated text (x, y) is the corner where the text starts at the top of its glyphs, w
 * its length along its baseline (as a fraction of the page width) and h its height: the box turns by r around (x, y).
 */
export interface TextItem { s: string; x: number; y: number; w: number; h: number; size: number; r?: number }
/**
 * src "pdf": read from the PDF (no items = a page without text, e.g. a scan); "ocr": recognised from the page image.
 * ver: how the page was read. Missing (1): before rotated text was kept (with r) and OCR dropped non-horizontal text;
 * TEXT_VERSION since then.
 */
export interface PageText { n: number; src: "pdf" | "ocr"; ver?: number; items: TextItem[] }
export interface TextChunk { v: 1; pages: PageText[] }
export const TEXT_VERSION = 2;

export const TEXT_CHUNK = 20;
const pad = (n: number) => String(n).padStart(4, "0");
/** 0-based chunk that holds a page. */
export const chunkOf = (page: number) => Math.floor((page - 1) / TEXT_CHUNK);
export const chunkCount = (pageCount: number) => Math.ceil(pageCount / TEXT_CHUNK);
/** First and last page of a chunk (the last chunk ends at the last page). */
export const chunkRange = (k: number, pageCount: number) => ({ from: k * TEXT_CHUNK + 1, to: Math.min(pageCount, (k + 1) * TEXT_CHUNK) });
/** File name of a chunk: always the full 20-page span, so a page's chunk never depends on the page count. */
export const chunkName = (k: number) => `${pad(k * TEXT_CHUNK + 1)}-${pad((k + 1) * TEXT_CHUNK)}.json`;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const MAX_ITEMS = 6000;
const MAX_CHARS = 2000;
/** An angle in (-180, 180], to a tenth of a degree. */
const angle = (deg: number) => {
  const a = Math.round((((deg % 360) + 540) % 360 - 180) * 10) / 10;
  return a === -180 ? 180 : a;
};
/** Below this (degrees) a run is stored as horizontal: the slight tilt of a scan. */
const MIN_ANGLE = 0.5;
/** From this far off horizontal (degrees) an item is rotated text: never selected, never copied. */
export const ROTATED_FROM = 10;
export const isRotated = (it: TextItem) => Math.abs(it.r ?? 0) >= ROTATED_FROM;

/**
 * A chunk as read from storage, checked before anything is drawn from it: wrong shapes and out-of-range values are
 * dropped (the text is only ever put into text nodes, never into HTML). Returns the pages of `from..to` it holds.
 */
export function parseChunk(raw: unknown, from: number, to: number): Map<number, PageText> {
  const out = new Map<number, PageText>();
  const pages = (raw as { v?: unknown; pages?: unknown } | null)?.pages;
  if ((raw as { v?: unknown } | null)?.v !== 1 || !Array.isArray(pages)) return out;
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  for (const p of pages.slice(0, TEXT_CHUNK)) {
    const n = (p as { n?: unknown }).n, src = (p as { src?: unknown }).src, items = (p as { items?: unknown }).items, ver = (p as { ver?: unknown }).ver;
    if (typeof n !== "number" || !Number.isInteger(n) || n < from || n > to || (src !== "pdf" && src !== "ocr") || !Array.isArray(items)) continue;
    const ok: TextItem[] = [];
    for (const it of items.slice(0, MAX_ITEMS)) {
      const t = it as Partial<TextItem>;
      if (typeof t.s !== "string" || !t.s || !num(t.x, -0.05, 1.05) || !num(t.y, -0.05, 1.05) || !num(t.w, 0, 1.1) || !num(t.h, 0, 1.1) || !t.w || !t.h) continue;
      const item: TextItem = { s: t.s.slice(0, MAX_CHARS), x: t.x!, y: t.y!, w: t.w!, h: t.h!, size: num(t.size, 0, 1.1) ? t.size! : t.h! };
      const r = num(t.r, -360, 360) ? angle(t.r!) : 0;
      if (Math.abs(r) >= MIN_ANGLE) item.r = r;
      ok.push(item);
    }
    const page: PageText = { n, src, items: ok };
    if (typeof ver === "number" && Number.isInteger(ver) && ver > 1 && ver < 100) page.ver = ver;
    out.set(n, page);
  }
  return out;
}

/** What a book's chunks add up to: pages with text, pages still without it (never recognised) and the status. */
export function textSummary(pages: ReadonlyMap<number, PageText>, pageCount: number) {
  let withText = 0, scanned = 0, ocr = 0;
  for (let n = 1; n <= pageCount; n++) {
    const p = pages.get(n);
    if (p?.items.length) withText++;
    else if (p?.src === "ocr") ocr++; // recognised, but there was nothing to read (a blank page)
    else if (p) scanned++;
  }
  const pending = pageCount - withText - ocr; // no text and never recognised (scans, or not extracted at all)
  const status: "none" | "partial" | "full" = withText === 0 ? "none" : pending === 0 ? "full" : "partial";
  return { text_pages: withText, scanned, pending, status };
}

/**
 * A run of text in page pixels (y down), as pdf.js gives it once the viewport is applied. (left, top) is the corner
 * where it starts at the top of its glyphs, width its length along its baseline; r its angle as in TextItem.
 */
export interface RawRun { s: string; left: number; top: number; width: number; height: number; r?: number }

/** pdf.js Util.transform: m1 x m2 for [a, b, c, d, e, f] matrices. */
const mul = (m1: number[], m2: number[]) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
/**
 * pdf.js getTextContent() output + the page viewport (its transform and scale) -> runs in viewport pixels. The top of a
 * run is its baseline minus the font's ascent, measured along the glyphs' own "up". Rotated text keeps its angle (r);
 * slanted, mirrored and vertical-font text is left out (it has no box to put a text layer in).
 */
export function runsFromPdf(content: { items: unknown[]; styles: Record<string, { ascent?: number; vertical?: boolean } | undefined> }, viewportTransform: number[], scale: number): RawRun[] {
  const out: RawRun[] = [];
  for (const raw of content.items) {
    const it = raw as { str?: unknown; transform?: unknown; width?: unknown; fontName?: unknown };
    if (typeof it.str !== "string" || !Array.isArray(it.transform) || it.transform.length !== 6) continue;
    const m = mul(viewportTransform, it.transform as number[]);
    const fontH = Math.hypot(m[2], m[3]), along = Math.hypot(m[0], m[1]);
    const style = typeof it.fontName === "string" ? content.styles[it.fontName] : undefined;
    // (m[0], m[1]) runs along the baseline, (m[2], m[3]) points down the glyphs (y is down): they must be at right
    // angles and not mirrored
    if (!(fontH > 0) || !(along > 0) || style?.vertical || Math.abs(m[0] * m[2] + m[1] * m[3]) > 0.01 * along * fontH || m[0] * m[3] - m[1] * m[2] >= 0) continue;
    const ascent = style?.ascent && style.ascent > 0.4 && style.ascent < 1.2 ? style.ascent : 0.8;
    const r = angle((-Math.atan2(m[1], m[0]) * 180) / Math.PI);
    const run: RawRun = { s: it.str, left: m[4] + ascent * m[2], top: m[5] + ascent * m[3], width: (typeof it.width === "number" ? it.width : 0) * scale, height: fontH };
    if (Math.abs(r) >= MIN_ANGLE) run.r = r;
    out.push(run);
  }
  return out;
}

/**
 * pdf.js runs -> items. Runs that continue each other on the same line (kerning pieces, words written one by one) are
 * merged into one item, with a space where the gap is a word gap. Runs in another column, size, line or direction
 * never merge. Rotated runs are compared along their own direction.
 */
export function itemsFromRuns(runs: RawRun[], pageW: number, pageH: number): TextItem[] {
  const out: TextItem[] = [];
  // u: along the text, v: across it, in page pixels; (x, y) the corner where the item starts
  let cur: { s: string; r: number; x: number; y: number; u0: number; u1: number; v: number; height: number; space: boolean } | null = null;
  const flush = () => {
    if (!cur) return;
    const s = cur.s.replace(/\s+/g, " ").trim();
    if (s) {
      const it: TextItem = { s, x: r4(cur.x / pageW), y: r4(cur.y / pageH), w: r4((cur.u1 - cur.u0) / pageW), h: r4(cur.height / pageH), size: r4(cur.height / pageH) };
      if (cur.r) it.r = cur.r;
      out.push(it);
    }
    cur = null;
  };
  for (const r of runs) {
    if (!r.s) continue;
    const rot = r.r ?? 0, a = (-rot * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const u = r.left * dx + r.top * dy, v = r.top * dx - r.left * dy;
    const blank = !r.s.trim();
    const same = cur !== null && rot === cur.r && Math.abs(v - cur.v) < 0.3 * cur.height && Math.abs(r.height - cur.height) < 0.3 * cur.height
      && u >= cur.u1 - 0.5 * cur.height && u - cur.u1 < 1.0 * cur.height;
    if (blank) { if (cur && (same || r.width <= 0)) cur.space = true; continue; }
    if (!(r.width > 0) || !(r.height > 0)) continue;
    if (cur && same) {
      const gap = u - cur.u1;
      if ((cur.space || gap > 0.18 * cur.height) && !/\s$/.test(cur.s) && !/^\s/.test(r.s)) cur.s += " ";
      cur.s += r.s;
      cur.u1 = Math.max(cur.u1, u + r.width);
      cur.space = false;
      continue;
    }
    flush();
    cur = { s: r.s, r: rot, x: r.left, y: r.top, u0: u, u1: u + r.width, v, height: r.height, space: false };
  }
  flush();
  return out;
}

interface OcrBox { x0: number; y0: number; x1: number; y1: number }
interface OcrWord { text: string; confidence: number; bbox: OcrBox }
interface OcrLine { bbox: OcrBox; baseline?: OcrBox; words: OcrWord[] }
/** A tesseract block (tesseract.js `blocks` output). */
export interface OcrBlock { blocktype?: number | string; paragraphs: { lines: OcrLine[] }[] }
/** Tesseract block types that hold no horizontal text: vertical text (7), images, rules and noise (9 to 14). */
const OCR_SKIP_BLOCKS = new Set([7, 9, 10, 11, 12, 13, 14]);
/** Words recognised with less confidence than this (0-100) are left out. */
const OCR_MIN_CONFIDENCE = 30;
const tallAndThin = (b: OcrBox, chars: number) => chars >= 3 && b.y1 - b.y0 > 1.5 * (b.x1 - b.x0);

/**
 * OCR result (tesseract blocks, in image pixels) -> word items. Words recognised with very low confidence and anything
 * that is not horizontal text (vertical blocks, tilted baselines, upright stacks of letters) are left out. A line is cut
 * where its words are far apart (tesseract may glue a margin or the next column to it); each word takes the top and
 * height of its part of the line.
 */
export function itemsFromOcr(blocks: readonly OcrBlock[], imgW: number, imgH: number): TextItem[] {
  const out: TextItem[] = [];
  for (const b of blocks) {
    if (OCR_SKIP_BLOCKS.has(Number(b.blocktype))) continue;
    for (const l of b.paragraphs.flatMap((p) => p.lines)) {
      const base = l.baseline;
      if (base && (base.x1 - base.x0 <= 0 || Math.abs(base.y1 - base.y0) > 0.18 * (base.x1 - base.x0))) continue; // tilted more than ~10°
      if (tallAndThin(l.bbox, l.words.reduce((n, w) => n + w.text.trim().length, 0))) continue;
      const words = l.words
        .filter((w) => w.text.trim() && w.confidence >= OCR_MIN_CONFIDENCE && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0 && !tallAndThin(w.bbox, w.text.trim().length))
        .sort((p, q) => p.bbox.x0 - q.bbox.x0);
      if (!words.length) continue;
      const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((p, q) => p - q);
      const lineH = hs[hs.length >> 1];
      let part: OcrWord[] = [];
      const flush = () => {
        if (!part.length) return;
        const top = Math.min(...part.map((w) => w.bbox.y0)), h = Math.max(...part.map((w) => w.bbox.y1)) - top;
        for (const w of part) out.push({ s: w.text.trim(), x: r4(w.bbox.x0 / imgW), y: r4(top / imgH), w: r4((w.bbox.x1 - w.bbox.x0) / imgW), h: r4(h / imgH), size: r4(h / imgH) });
        part = [];
      };
      for (const w of words) {
        if (part.length && w.bbox.x0 - part[part.length - 1].bbox.x1 > 1.5 * lineH) flush();
        part.push(w);
      }
      flush();
    }
  }
  return out;
}

/** A selected piece of a text layer: the page, the item index and the selected part of its text. */
export interface Piece { page: number; i: number; text: string }

/**
 * Left and right edge of the line an item is on: the items beside it on the same line, up to a column-sized gap.
 * `next` is where the next column starts on that line (Infinity when nothing is to its right).
 */
function lineBox(items: readonly TextItem[], it: TextItem, em: number) {
  const row = items.filter((o) => !isRotated(o) && Math.abs(o.y - it.y) < 0.5 * it.h && Math.abs(o.h - it.h) < 0.5 * it.h).sort((a, b) => a.x - b.x);
  const i = row.indexOf(it);
  if (i < 0) return { left: it.x, right: it.x + it.w, next: Infinity };
  let l = i, r = i;
  while (l > 0 && row[l].x - (row[l - 1].x + row[l - 1].w) < 1.2 * em) l--;
  while (r < row.length - 1 && row[r + 1].x - (row[r].x + row[r].w) < 1.2 * em) r++;
  return { left: row[l].x, right: row[r].x + row[r].w, next: r < row.length - 1 ? row[r + 1].x : Infinity };
}

/**
 * Plain text for copying: pieces on one line are joined with a space where there is a word gap; a line that
 * continues the same paragraph is joined with a space (a hyphen at the end of the line is removed when the next line
 * goes on with a lowercase letter); anything else (a new paragraph, column, heading or page) starts a new line.
 * `ratio` is the page height / width (heights are fractions of the height, widths of the width).
 */
export function joinPieces(pieces: Piece[], itemsOf: (page: number) => readonly TextItem[], ratio: (page: number) => number): string {
  let out = "";
  let prev: { page: number; it: TextItem } | null = null;
  for (const p of pieces) {
    const it = itemsOf(p.page)[p.i];
    if (!it) continue;
    if (!prev) {
      out = p.text;
      prev = { page: p.page, it };
      continue;
    }
    const a = prev.it, items = itemsOf(p.page), em = a.h * ratio(p.page); // a's font size in page-width units
    if (p.page !== prev.page) {
      out += "\n";
    } else if (Math.abs(it.y - a.y) < 0.5 * a.h && Math.abs(it.h - a.h) < 0.5 * a.h && it.x >= a.x) {
      const gap = it.x - (a.x + a.w);
      if (gap > 1.2 * em) out += "\n"; // the same height, but in the next column
      else if (gap > 0.15 * em && !/\s$/.test(out) && !/^\s/.test(p.text)) out += " ";
    } else {
      const was = lineBox(items, a, em), now = lineBox(items, it, em);
      // the right edge of this column: the longest line of the page that starts where this one does, in the same size,
      // and ends before the next column (a full-width paragraph above two columns is not part of the first one)
      let colRight = was.right;
      for (const o of items) {
        if (Math.abs(o.x - was.left) < 3 * em && Math.abs(o.h - a.h) < 0.12 * a.h && !isRotated(o)) {
          const right = lineBox(items, o, em).right;
          if (right <= was.next) colRight = Math.max(colRight, right);
        }
      }
      const next = it.y - a.y, dx = now.left - was.left;
      const wrap = Math.abs(it.h - a.h) < 0.25 * a.h && next > 0.5 * a.h && next < 2.2 * a.h
        && dx <= 0.6 * em && dx >= -2.5 * em && was.right >= colRight - 2.5 * em;
      if (wrap && /\p{L}-$/u.test(out) && /^\p{Ll}/u.test(p.text)) out = out.slice(0, -1);
      else out += wrap ? " " : "\n";
    }
    out += p.text;
    prev = { page: p.page, it };
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ---- layout: body text in reading order, margin material apart ----

/** What the layer does with an item: body text, margin text (selectable only from a drag that starts on it), rotated text (never selected). */
export const BODY = 0, MARGIN = 1, ROTATED = 2;
export interface Layout {
  /** item indexes, body text first in reading order, then the margin */
  order: number[];
  /** how many of `order` are body text */
  body: number;
  /** per item: BODY, MARGIN or ROTATED */
  kind: Uint8Array;
  /** per item: its place in `order` */
  rank: Int32Array;
}

/** A piece of a printed line: horizontal items side by side with no column-sized gap between them (page-width units). */
interface Seg { items: number[]; l: number; r: number; t: number; b: number; h: number; chars: number; margin: boolean }
const overlapX = (a: { l: number; r: number }, b: { l: number; r: number }) => Math.min(a.r, b.r) - Math.max(a.l, b.l);

/**
 * Splits a page's items into body text and margin text and puts the body in reading order. Runs where the layer is
 * built, so it applies to every stored chunk, old or new.
 * - Margin: rotated items; a running header or footer (one or two lines at the top or bottom edge, set apart by a gap);
 *   anything clearly outside the main text area on the left or right (side tabs, marginal notes, OCR noise there).
 * - Reading order: lines are chained into blocks (a line and the one under it, when each is the other's only
 *   neighbour), and blocks are ordered by Breuel's rules: a block comes before the blocks under it that share some
 *   width with it, and before the blocks to its right unless something spanning both lies between them. So a column
 *   is read to its end before the next one, and a full-width heading or caption still separates rows of columns.
 * `ratio` is the page height / width.
 */
export function pageLayout(items: readonly TextItem[], ratio: number): Layout {
  const n = items.length;
  const kind = new Uint8Array(n);
  const flat: number[] = [];
  for (let i = 0; i < n; i++) if (isRotated(items[i])) kind[i] = ROTATED; else flat.push(i);

  // 1. rows (by vertical centre) and the line pieces (segments) in each row
  const t = (i: number) => items[i].y * ratio, hh = (i: number) => items[i].h * ratio;
  flat.sort((a, b) => t(a) + hh(a) / 2 - (t(b) + hh(b) / 2));
  const rows: { c: number; h: number; items: number[] }[] = [];
  for (const i of flat) {
    const c = t(i) + hh(i) / 2, row = rows[rows.length - 1];
    if (row && Math.abs(c - row.c) < 0.5 * Math.min(row.h, hh(i))) { row.items.push(i); row.h = Math.max(row.h, hh(i)); }
    else rows.push({ c, h: hh(i), items: [i] });
  }
  const segs: Seg[] = [];
  const rowSegs: Seg[][] = [];
  for (const row of rows) {
    row.items.sort((a, b) => items[a].x - items[b].x);
    const mine: Seg[] = [];
    let cur: Seg | null = null;
    for (const i of row.items) {
      const it = items[i], h = hh(i);
      if (cur && it.x - cur.r < 1.0 * Math.max(h, cur.h)) {
        cur.items.push(i); cur.r = Math.max(cur.r, it.x + it.w); cur.t = Math.min(cur.t, t(i)); cur.b = Math.max(cur.b, t(i) + h);
        cur.h = cur.b - cur.t; cur.chars += it.s.length;
        continue;
      }
      cur = { items: [i], l: it.x, r: it.x + it.w, t: t(i), b: t(i) + h, h, chars: it.s.length, margin: false };
      mine.push(cur);
      segs.push(cur);
    }
    rowSegs.push(mine);
  }
  // the body text size: the median height, counted by characters
  const bySize = [...segs].sort((a, b) => a.h - b.h);
  let half = segs.reduce((s, g) => s + g.chars, 0) / 2, bodyH = bySize[0]?.h ?? 0;
  for (const g of bySize) { bodyH = g.h; if ((half -= g.chars) <= 0) break; }

  // 2. running header and footer: one or two rows at the top or bottom edge, no larger than the body text, set apart
  //    from the rest by a gap
  const gap = 1.2 * bodyH;
  const edge = (from: number, step: 1 | -1) => {
    const picked: Seg[][] = [];
    let k = from;
    while (k >= 0 && k < rowSegs.length) {
      picked.push(rowSegs[k]);
      const next = rowSegs[k + step];
      if (!next) return null; // nothing else on the page
      const top = (s: Seg[]) => Math.min(...s.map((g) => g.t)), bot = (s: Seg[]) => Math.max(...s.map((g) => g.b));
      if ((step === 1 ? top(next) - bot(rowSegs[k]) : top(rowSegs[k]) - bot(next)) >= gap) break;
      k += step;
    }
    const all = picked.flat();
    if (picked.length > 2 || all.some((g) => g.h > 1.1 * bodyH)) return null; // a heading is larger than the body text
    const inBand = step === 1 ? Math.max(...all.map((g) => g.b)) <= 0.12 * ratio : Math.min(...all.map((g) => g.t)) >= 0.88 * ratio;
    return inBand ? all : null;
  };
  for (const g of [...(edge(0, 1) ?? []), ...(edge(rowSegs.length - 1, -1) ?? [])]) g.margin = true;

  // 3. left and right of the main text area (its lines' widest extent): side tabs, marginal notes, OCR noise
  const lines = segs.filter((g) => !g.margin && g.r - g.l >= 0.2);
  if (lines.length >= 3) {
    const left = Math.min(...lines.map((g) => g.l)), right = Math.max(...lines.map((g) => g.r)), tol = 1.5 * bodyH;
    for (const g of segs) if (g.r < left - tol || g.l > right + tol) g.margin = true;
  }

  // 4. reading order of the body: chains of lines, then the chains in Breuel's order
  const body = segs.filter((g) => !g.margin).sort((a, b) => a.t - b.t || a.l - b.l);
  const below: number[][] = body.map(() => []), above: number[][] = body.map(() => []);
  for (let a = 0; a < body.length; a++) {
    const s = body[a];
    for (let b = a + 1; b < body.length; b++) {
      const u = body[b];
      if (u.t > s.b + 1.2 * Math.max(s.h, u.h)) break; // sorted by top: nothing further down is close enough
      if (u.t < s.t + 0.5 * Math.min(s.h, u.h) || u.t - s.b < -0.3 * Math.min(s.h, u.h)) continue; // not under it
      if (overlapX(s, u) < 0.3 * Math.min(s.r - s.l, u.r - u.l)) continue;
      below[a].push(b); above[b].push(a);
    }
  }
  const chainOf = new Int32Array(body.length).fill(-1);
  const blocks: { segs: number[]; l: number; r: number; t: number; b: number; c: number }[] = [];
  for (let a = 0; a < body.length; a++) {
    if (chainOf[a] >= 0) continue;
    const blk = { segs: [] as number[], l: Infinity, r: -Infinity, t: Infinity, b: -Infinity, c: 0 };
    for (let k = a; ; ) {
      chainOf[k] = blocks.length;
      blk.segs.push(k);
      const g = body[k];
      blk.l = Math.min(blk.l, g.l); blk.r = Math.max(blk.r, g.r); blk.t = Math.min(blk.t, g.t); blk.b = Math.max(blk.b, g.b);
      const next = below[k].length === 1 ? below[k][0] : -1;
      if (next < 0 || above[next].length !== 1 || chainOf[next] >= 0) break;
      k = next;
    }
    blk.c = (blk.t + blk.b) / 2;
    blocks.push(blk);
  }
  const m = blocks.length;
  let seq: number[];
  if (m > 200) {
    seq = blocks.map((_, i) => i); // too many to compare (a huge table or diagram): top to bottom
  } else {
    // after[a]: the blocks that must come after a
    const after: number[][] = blocks.map(() => []);
    const indeg = new Int32Array(m);
    const tol = 0.25 * bodyH;
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        if (a === b) continue;
        const A = blocks[a], B = blocks[b];
        let first = false;
        if (overlapX(A, B) > 0) first = A.b <= B.t + tol && A.c < B.c; // above it, sharing some width
        else if (A.r <= B.l) { // to its left, unless something spanning both lies between them
          first = true;
          const lo = Math.min(A.c, B.c), hi = Math.max(A.c, B.c);
          for (let k = 0; k < m && first; k++) {
            const C = blocks[k];
            if (k !== a && k !== b && C.c > lo && C.c < hi && C.l < A.r && C.r > B.l) first = false;
          }
        }
        if (first) { after[a].push(b); indeg[b]++; }
      }
    }
    seq = [];
    const done = new Uint8Array(m);
    for (let step = 0; step < m; step++) {
      // the top-most (then left-most) block with nothing left to come before it; on a cycle, the top-most left
      let pick = -1;
      for (const free of [true, false]) {
        for (let k = 0; k < m; k++) {
          if (done[k] || (free && indeg[k] > 0)) continue;
          if (pick < 0 || blocks[k].t < blocks[pick].t - tol || (Math.abs(blocks[k].t - blocks[pick].t) <= tol && blocks[k].l < blocks[pick].l)) pick = k;
        }
        if (pick >= 0) break;
      }
      done[pick] = 1;
      seq.push(pick);
      for (const b of after[pick]) indeg[b]--;
    }
  }
  const order: number[] = [];
  for (const k of seq) for (const g of blocks[k].segs) order.push(...[...body[g].items].sort((a, b) => items[a].x - items[b].x));
  const bodyCount = order.length;
  const margin = segs.filter((g) => g.margin).flatMap((g) => g.items);
  for (let i = 0; i < n; i++) if (kind[i] === ROTATED) margin.push(i);
  margin.sort((a, b) => items[a].y - items[b].y || items[a].x - items[b].x);
  for (const i of margin) { if (kind[i] !== ROTATED) kind[i] = MARGIN; order.push(i); }
  const rank = new Int32Array(n);
  order.forEach((i, k) => { rank[i] = k; });
  return { order, body: bodyCount, kind, rank };
}
