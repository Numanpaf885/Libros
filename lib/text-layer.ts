// The selectable text of a book's pages: the stored format, the chunking and the pure helpers shared by the admin
// (extraction, OCR) and the reader (text layer, copy). No pdf.js and nothing server-only here.
//
// Stored in R2 as JSON chunks of TEXT_CHUNK pages: {prefix}/text/0001-0020.json, 0021-0040.json, ... Each chunk is
// { v: 1, pages: [{ n, src, items }] } with only the pages that have been processed.

/** One run of text on a page. x, y (top), w, h are fractions of the page width / height; size is the font size as a fraction of the page height. */
export interface TextItem { s: string; x: number; y: number; w: number; h: number; size: number }
/** src "pdf": read from the PDF (no items = a page without text, e.g. a scan); "ocr": recognised from the page image. */
export interface PageText { n: number; src: "pdf" | "ocr"; items: TextItem[] }
export interface TextChunk { v: 1; pages: PageText[] }

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
    const n = (p as { n?: unknown }).n, src = (p as { src?: unknown }).src, items = (p as { items?: unknown }).items;
    if (typeof n !== "number" || !Number.isInteger(n) || n < from || n > to || (src !== "pdf" && src !== "ocr") || !Array.isArray(items)) continue;
    const ok: TextItem[] = [];
    for (const it of items.slice(0, MAX_ITEMS)) {
      const t = it as Partial<TextItem>;
      if (typeof t.s !== "string" || !t.s || !num(t.x, -0.05, 1.05) || !num(t.y, -0.05, 1.05) || !num(t.w, 0, 1.1) || !num(t.h, 0, 1.1) || !t.w || !t.h) continue;
      ok.push({ s: t.s.slice(0, MAX_CHARS), x: t.x!, y: t.y!, w: t.w!, h: t.h!, size: num(t.size, 0, 1.1) ? t.size! : t.h! });
    }
    out.set(n, { n, src, items: ok });
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

/** A run of text in page pixels (y down), as pdf.js gives it once the viewport is applied. */
export interface RawRun { s: string; left: number; top: number; width: number; height: number }

/** pdf.js Util.transform: m1 x m2 for [a, b, c, d, e, f] matrices. */
const mul = (m1: number[], m2: number[]) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
/**
 * pdf.js getTextContent() output + the page viewport (its transform and scale) -> runs in viewport pixels. The top of a
 * run is its baseline minus the font's ascent. Rotated and vertical text is left out (it has no text layer).
 */
export function runsFromPdf(content: { items: unknown[]; styles: Record<string, { ascent?: number; vertical?: boolean } | undefined> }, viewportTransform: number[], scale: number): RawRun[] {
  const out: RawRun[] = [];
  for (const raw of content.items) {
    const it = raw as { str?: unknown; transform?: unknown; width?: unknown; fontName?: unknown };
    if (typeof it.str !== "string" || !Array.isArray(it.transform) || it.transform.length !== 6) continue;
    const m = mul(viewportTransform, it.transform as number[]);
    const fontH = Math.hypot(m[2], m[3]);
    const style = typeof it.fontName === "string" ? content.styles[it.fontName] : undefined;
    if (!(fontH > 0) || style?.vertical || Math.abs(m[1]) > 0.01 * fontH || Math.abs(m[2]) > 0.01 * fontH) continue;
    const ascent = style?.ascent && style.ascent > 0.4 && style.ascent < 1.2 ? style.ascent : 0.8;
    out.push({ s: it.str, left: m[4], top: m[5] - ascent * fontH, width: (typeof it.width === "number" ? it.width : 0) * scale, height: fontH });
  }
  return out;
}

/**
 * pdf.js runs -> items. Runs that continue each other on the same line (kerning pieces, words written one by one) are
 * merged into one item, with a space where the gap is a word gap. Runs in another column, size or line never merge.
 */
export function itemsFromRuns(runs: RawRun[], pageW: number, pageH: number): TextItem[] {
  const out: TextItem[] = [];
  let cur: { s: string; left: number; right: number; top: number; height: number; space: boolean } | null = null;
  const flush = () => {
    if (!cur) return;
    const s = cur.s.replace(/\s+/g, " ").trim();
    if (s) out.push({ s, x: r4(cur.left / pageW), y: r4(cur.top / pageH), w: r4((cur.right - cur.left) / pageW), h: r4(cur.height / pageH), size: r4(cur.height / pageH) });
    cur = null;
  };
  for (const r of runs) {
    if (!r.s) continue;
    const blank = !r.s.trim();
    const same = cur !== null && Math.abs(r.top - cur.top) < 0.3 * cur.height && Math.abs(r.height - cur.height) < 0.3 * cur.height
      && r.left >= cur.right - 0.5 * cur.height && r.left - cur.right < 1.0 * cur.height;
    if (blank) { if (cur && (same || r.width <= 0)) cur.space = true; continue; }
    if (!(r.width > 0) || !(r.height > 0)) continue;
    if (cur && same) {
      const gap = r.left - cur.right;
      if ((cur.space || gap > 0.18 * cur.height) && !/\s$/.test(cur.s) && !/^\s/.test(r.s)) cur.s += " ";
      cur.s += r.s;
      cur.right = Math.max(cur.right, r.left + r.width);
      cur.space = false;
      continue;
    }
    flush();
    cur = { s: r.s, left: r.left, right: r.left + r.width, top: r.top, height: r.height, space: false };
  }
  flush();
  return out;
}

/** OCR result (tesseract lines and words, in image pixels) -> word items. Each word takes its line's top and height. */
export function itemsFromOcr(lines: { bbox: { y0: number; y1: number }; words: { text: string; confidence: number; bbox: { x0: number; x1: number; y0: number; y1: number } }[] }[], imgW: number, imgH: number): TextItem[] {
  const out: TextItem[] = [];
  for (const l of lines) {
    const top = l.bbox.y0, h = l.bbox.y1 - l.bbox.y0;
    if (!(h > 0)) continue;
    for (const w of l.words) {
      const s = w.text.trim();
      if (!s || w.confidence < 20 || !(w.bbox.x1 > w.bbox.x0)) continue;
      out.push({ s, x: r4(w.bbox.x0 / imgW), y: r4(top / imgH), w: r4((w.bbox.x1 - w.bbox.x0) / imgW), h: r4(h / imgH), size: r4(h / imgH) });
    }
  }
  return out;
}

/** A selected piece of a text layer: the page, the item index and the selected part of its text. */
export interface Piece { page: number; i: number; text: string }

/** Left and right edge of the line an item is on: the items beside it on the same line, up to a column-sized gap. */
function lineBox(items: readonly TextItem[], it: TextItem, em: number) {
  const row = items.filter((o) => Math.abs(o.y - it.y) < 0.5 * it.h && Math.abs(o.h - it.h) < 0.5 * it.h).sort((a, b) => a.x - b.x);
  const i = row.indexOf(it);
  if (i < 0) return { left: it.x, right: it.x + it.w };
  let l = i, r = i;
  while (l > 0 && row[l].x - (row[l - 1].x + row[l - 1].w) < 1.2 * em) l--;
  while (r < row.length - 1 && row[r + 1].x - (row[r].x + row[r].w) < 1.2 * em) r++;
  return { left: row[l].x, right: row[r].x + row[r].w };
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
      // the right edge of this column: the longest line of the page that starts where this one does, in the same size
      let colRight = was.right;
      for (const o of items) {
        if (Math.abs(o.x - was.left) < 3 * em && Math.abs(o.h - a.h) < 0.12 * a.h) colRight = Math.max(colRight, lineBox(items, o, em).right);
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
