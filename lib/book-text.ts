import "server-only";
import { textColumnsReady } from "./db/repo";
import { storage, TEXT_RE, textKey, textPrefix } from "./storage";
import { chunkCount, chunkRange, parseChunk, TEXT_CHUNK, textSummary, type PageText } from "./text-layer";
import type { Book } from "./types";

/** Readers get a text layer only when the sheet has the text columns, the admin allows copying and some page has text. */
export async function readerHasText(book: Book): Promise<boolean> {
  return book.allow_copy && book.text_pages > 0 && (await textColumnsReady());
}

/** The chunks stored for a book (0-based indexes). */
export async function storedChunks(b: Book): Promise<number[]> {
  const out: number[] = [];
  for (const key of await storage().list(textPrefix(b.storage_prefix))) {
    const m = TEXT_RE.test(key) ? /\/(\d{4})-\d{4}\.json$/.exec(key) : null;
    const from = m ? Number(m[1]) : 0;
    if (from > 0 && (from - 1) % TEXT_CHUNK === 0 && (from - 1) / TEXT_CHUNK < chunkCount(b.page_count)) out.push((from - 1) / TEXT_CHUNK);
  }
  return out.sort((a, c) => a - c);
}

/** Every processed page of the book's text, read from the chunks themselves (a few at a time). */
export async function readAllText(b: Book): Promise<Map<number, PageText>> {
  const all = new Map<number, PageText>();
  const ks = await storedChunks(b);
  for (let i = 0; i < ks.length; i += 8) {
    await Promise.all(ks.slice(i, i + 8).map(async (k) => {
      const raw = await storage().readText(textKey(b.storage_prefix, k));
      if (!raw) return;
      let json: unknown;
      try { json = JSON.parse(raw); } catch { return; }
      const { from, to } = chunkRange(k, b.page_count);
      for (const [n, p] of parseChunk(json, from, to)) all.set(n, p);
    }));
  }
  return all;
}

/**
 * One character per page for the admin: "t" text from the PDF, "o" text recognised by OCR, "s" a page without text
 * (a scan), "b" recognised but blank, "-" not processed yet.
 */
export function pageMap(pages: ReadonlyMap<number, PageText>, pageCount: number): string {
  let s = "";
  for (let n = 1; n <= pageCount; n++) {
    const p = pages.get(n);
    s += !p ? "-" : p.items.length ? (p.src === "ocr" ? "o" : "t") : p.src === "ocr" ? "b" : "s";
  }
  return s;
}

export { textSummary };
