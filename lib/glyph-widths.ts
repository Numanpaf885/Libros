// Character widths of standard Helvetica (1/1000 em) and the WinAnsi (Windows-1252) codes it is written with. Pure and
// tiny: shared by the downloads' invisible text (lib/client/pdf-text.ts) and the search, which sizes a match inside a
// line by these widths (the reader's text layer is set in a similar sans-serif).

/** Helvetica widths (1/1000 em) of WinAnsi codes 32..255. */
export const HELVETICA_WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
/** Unicode characters WinAnsi puts in 128..159 (and the few it places elsewhere). */
export const WINANSI_HIGH: Record<number, number> = { 338: 140, 339: 156, 352: 138, 353: 154, 376: 159, 381: 142, 382: 158, 402: 131, 710: 136, 732: 152, 8211: 150, 8212: 151, 8216: 145, 8217: 146, 8218: 130, 8220: 147, 8221: 148, 8222: 132, 8224: 134, 8225: 135, 8226: 149, 8230: 133, 8240: 137, 8249: 139, 8250: 155, 8364: 128, 8482: 153 };

/** The WinAnsi code of a character, or null when WinAnsi has none. */
export const winAnsiCode = (cp: number): number | null => ((cp >= 32 && cp < 127) || (cp >= 160 && cp <= 255) ? cp : WINANSI_HIGH[cp] ?? null);

/** Width of one character in Helvetica (em): its WinAnsi glyph, or its letter without accents, or an average. */
export function charWidth(ch: string): number {
  const c = winAnsiCode(ch.codePointAt(0)!) ?? winAnsiCode(ch.normalize("NFKD").codePointAt(0)!);
  return (c === null ? 556 : HELVETICA_WIDTHS[c - 32] || 556) / 1000;
}
/** Width of a string in Helvetica (em). */
export const textWidth = (s: string) => { let w = 0; for (const ch of s) w += charWidth(ch); return w; };
