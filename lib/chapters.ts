// A book's chapters: a title and the FILE page where each starts, stored in books.chapters as compact JSON
// ([{"t":"Capítulo 1","p":5}, ...]). A chapter runs until the page before the next one; the last one to the end of the
// book. Pure: shared by the server (validation), the admin (editing) and the reader (list, downloads).

export interface Chapter { t: string; p: number }
export interface ChapterRange { t: string; from: number; to: number }

export const MAX_CHAPTERS = 500;
export const MAX_TITLE = 200;
/** Longest stored value (a Google Sheets cell holds 50,000 characters). */
export const MAX_RAW = 40_000;

const clean = (s: string) => s.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);

/**
 * Chapters from what is stored (or sent): bad entries are dropped, titles cleaned, pages kept within 1..pageCount,
 * sorted by page, one chapter per page (the first one wins). Never throws.
 */
export function parseChapters(raw: string, pageCount: number): Chapter[] {
  if (!raw || !raw.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  return normalizeChapters(Array.isArray(data) ? data : [], pageCount);
}

export function normalizeChapters(list: readonly unknown[], pageCount: number): Chapter[] {
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const c of list.slice(0, MAX_CHAPTERS * 2)) {
    const t = typeof (c as Chapter)?.t === "string" ? clean((c as Chapter).t) : "";
    const p = (c as Chapter)?.p;
    if (!t || typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > pageCount || seen.has(p)) continue;
    seen.add(p);
    out.push({ t, p });
  }
  return out.sort((a, b) => a.p - b.p).slice(0, MAX_CHAPTERS);
}

export const stringifyChapters = (c: readonly Chapter[]) => (c.length ? JSON.stringify(c.map(({ t, p }) => ({ t, p }))) : "");

/** Each chapter with its pages (file pages, inclusive). */
export function chapterRanges(chapters: readonly Chapter[], pageCount: number): ChapterRange[] {
  return chapters.map((c, i) => ({ t: c.t, from: c.p, to: i + 1 < chapters.length ? chapters[i + 1].p - 1 : pageCount }));
}

/** The index of the chapter page n is in (-1 before the first chapter, or when there are none). */
export function chapterIndexOf(chapters: readonly Chapter[], n: number): number {
  let k = -1;
  for (let i = 0; i < chapters.length && chapters[i].p <= n; i++) k = i;
  return k;
}

/** A file-name-friendly version of a title: "Capítulo 2: La sustentación" -> "capitulo-2-la-sustentacion". */
export function fileSlug(title: string): string {
  return title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "capitulo";
}
