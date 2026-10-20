// Printed page numbers. The PDF "PageLabels" model as compact ranges, stored as JSON in books.page_labels.
// Internally everything keeps using the FILE page index (1-based); labels are only a display and input layer.
export type LabelStyle = "D" | "r" | "R" | "a" | "A" | "none";
export interface LabelRange {
  /** first FILE page (1-based) of the range */
  start: number;
  style: LabelStyle;
  /** text before the number, or the whole label when style is "none" */
  prefix?: string;
  /** number printed on the first page of the range (default 1) */
  first?: number;
}
const STYLES = new Set<string>(["D", "r", "R", "a", "A", "none"]);

/** Parses and validates the stored JSON. Anything odd -> no labels. */
export function parseLabels(raw: string | null | undefined, pageCount?: number): LabelRange[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length === 0 || v.length > 500) return [];
    const out: LabelRange[] = [];
    for (const r of v as Record<string, unknown>[]) {
      if (!r || typeof r !== "object") return [];
      const start = r.start, style = r.style;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || typeof style !== "string" || !STYLES.has(style)) return [];
      if (out.length && start <= out[out.length - 1].start) return [];
      if (pageCount !== undefined && start > pageCount) return [];
      const prefix = typeof r.prefix === "string" ? r.prefix.slice(0, 40) : undefined;
      const first = typeof r.first === "number" && Number.isInteger(r.first) && r.first >= 0 && r.first < 100000 ? r.first : undefined;
      out.push({ start, style: style as LabelStyle, ...(prefix ? { prefix } : {}), ...(first !== undefined && first !== 1 ? { first } : {}) });
    }
    if (out[0].start !== 1) out.unshift({ start: 1, style: "D" }); // pages before the first range are plain numbers
    return out;
  } catch {
    return [];
  }
}
export const stringifyLabels = (r: LabelRange[]) => (r.length ? JSON.stringify(r) : "");

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
export function toRoman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}
export function fromRoman(s: string): number | null {
  const t = s.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(t)) return null;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN.find(([, r]) => r === t[i])![0];
    const next = i + 1 < t.length ? ROMAN.find(([, r]) => r === t[i + 1])![0] : 0;
    n += v < next ? -v : v;
  }
  return toRoman(n) === t ? n : null; // only canonical numerals
}
const toAlpha = (n: number) => {
  // a..z, aa..zz, aaa..: the PDF model repeats the letter
  const k = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(97 + ((n - 1) % 26)).repeat(k);
};

function rangeIndex(ranges: LabelRange[], page: number): number {
  let lo = 0;
  for (let i = 0; i < ranges.length; i++) if (ranges[i].start <= page) lo = i; else break;
  return lo;
}
/** Printed label of FILE page n. No labels: the number itself. */
export function labelOf(ranges: LabelRange[], page: number): string {
  if (!ranges.length) return String(page);
  const r = ranges[rangeIndex(ranges, page)];
  if (r.style === "none") return r.prefix ?? "";
  const num = (r.first ?? 1) + (page - r.start);
  const body = r.style === "D" ? String(num) : r.style === "r" ? toRoman(num) : r.style === "R" ? toRoman(num).toUpperCase() : r.style === "a" ? toAlpha(num) : toAlpha(num).toUpperCase();
  return (r.prefix ?? "") + body;
}
export const hasLabels = (ranges: LabelRange[]) => ranges.length > 0;

/** Pages of the file, 1..count, that print a plain decimal number (no prefix): the book's "real" pages. */
function decimalNumber(ranges: LabelRange[], page: number): number | null {
  const r = ranges[rangeIndex(ranges, page)];
  return r.style === "D" && !r.prefix ? (r.first ?? 1) + (page - r.start) : null;
}
/** The "/ total" of the indicator: the highest decimal label, or the file's page count when there are no labels. */
export function labelTotal(ranges: LabelRange[], pageCount: number): number {
  if (!ranges.length) return pageCount;
  let max = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.style !== "D" || r.prefix) continue;
    const end = (i + 1 < ranges.length ? ranges[i + 1].start : pageCount + 1) - 1;
    max = Math.max(max, (r.first ?? 1) + (end - r.start));
  }
  return max || pageCount;
}

/**
 * Finds the FILE page for what the reader typed: a decimal number (the printed number) or a roman numeral (front matter),
 * or an exact label ("Portada"). With no labels, a number is a file page. Returns null when nothing matches.
 */
export function pageFromInput(ranges: LabelRange[], pageCount: number, input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (!ranges.length) return /^\d{1,5}$/.test(t) && Number(t) >= 1 && Number(t) <= pageCount ? Number(t) : null;
  const lower = t.toLowerCase();
  if (/^\d{1,5}$/.test(t)) {
    const n = Number(t);
    for (let p = 1; p <= pageCount; p++) if (decimalNumber(ranges, p) === n) return p;
    return null;
  }
  for (let p = 1; p <= pageCount; p++) if (labelOf(ranges, p).toLowerCase() === lower) return p; // "iii", "Portada", "A-3"
  return null;
}

/** Printed label of a spread/range for display: "45–46", "iii", "Portada–iv". */
export function labelSpan(ranges: LabelRange[], a: number, b: number): string {
  const x = labelOf(ranges, a), y = labelOf(ranges, b);
  return a === b || x === y ? x : `${x}–${y}`;
}

/**
 * From the list a PDF's getPageLabels() returns (one string per page) to compact ranges. Only the shapes this model can
 * represent are recognised (decimal, roman, letters, prefix + number, or a fixed text); anything else -> a "none" range.
 */
export function rangesFromPageLabels(labels: (string | null)[] | null | undefined): LabelRange[] {
  if (!labels || labels.length === 0) return [];
  if (labels.every((l, i) => l === String(i + 1))) return []; // the same as no labels
  const parse = (l: string): { style: LabelStyle; prefix: string; num: number } | null => {
    const m = /^(.*?)(\d{1,6})$/.exec(l);
    if (m) return { style: "D", prefix: m[1], num: Number(m[2]) };
    const ro = /^(.*?)([ivxlcdm]+)$/.exec(l), RO = /^(.*?)([IVXLCDM]+)$/.exec(l);
    const plain = (pre: string) => pre === "" || /[^\p{L}]$/u.test(pre); // "Index" is a word, not "Inde" + x
    if (ro && plain(ro[1]) && fromRoman(ro[2])) return { style: "r", prefix: ro[1], num: fromRoman(ro[2])! };
    if (RO && plain(RO[1]) && fromRoman(RO[2])) return { style: "R", prefix: RO[1], num: fromRoman(RO[2])! };
    return null;
  };
  const out: LabelRange[] = [];
  let prev: { style: LabelStyle; prefix: string; num: number } | null = null;
  labels.forEach((raw, i) => {
    const l = raw ?? "";
    const p = parse(l);
    const cont = p && prev && p.style === prev.style && p.prefix === prev.prefix && p.num === prev.num + 1;
    if (cont) { prev = p; return; }
    if (!p) {
      const last = out[out.length - 1];
      if (last && last.style === "none" && last.prefix === l && prev === null) return; // same fixed text on consecutive pages
      out.push({ start: i + 1, style: "none", ...(l ? { prefix: l } : {}) });
      prev = null;
      return;
    }
    out.push({ start: i + 1, style: p.style, ...(p.prefix ? { prefix: p.prefix } : {}), ...(p.num !== 1 ? { first: p.num } : {}) });
    prev = p;
  });
  return out.length > 500 ? [] : out;
}

/** The manual editor: "page 1 of the book is on file page N", earlier pages in roman numerals or unnumbered, optional cover label. */
export function rangesFromOffset(o: { firstFilePage: number; before: "roman" | "none"; coverLabel: string }): LabelRange[] {
  const n = Math.max(1, Math.floor(o.firstFilePage));
  const out: LabelRange[] = [];
  const cover = o.coverLabel.trim().slice(0, 40);
  if (n > 1) {
    if (cover) {
      out.push({ start: 1, style: "none", prefix: cover });
      if (n > 2) out.push(o.before === "roman" ? { start: 2, style: "r" } : { start: 2, style: "none" });
    } else out.push(o.before === "roman" ? { start: 1, style: "r" } : { start: 1, style: "none" });
    out.push({ start: n, style: "D" });
  } else {
    out.push({ start: 1, style: "D" });
  }
  return out;
}

/** "45–60 (archivo 57–72)": a file page range in printed numbers, with the file pages next to it. No labels: "57–72". */
export function rangeText(ranges: LabelRange[], from: number, to: number): string {
  const file = from === to ? String(from) : `${from}–${to}`;
  return ranges.length ? `${labelSpan(ranges, from, to)} (archivo ${file})` : file;
}
