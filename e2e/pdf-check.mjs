// Opens a PDF with pdfjs-dist (the legacy build runs in Node) and reports page sizes and whether any page has text.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
export async function inspectPdf(file, { sample = 0 } = {}) {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data, verbosity: 0, useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  const sizes = [];
  let textItems = 0, annots = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    if (sample && i > sample && i < doc.numPages) continue;
    const pg = await doc.getPage(i);
    const v = pg.getViewport({ scale: 1 });
    sizes.push([i, Math.round(v.width), Math.round(v.height)]);
    textItems += (await pg.getTextContent()).items.length;
    annots += (await pg.getAnnotations()).length;
    pg.cleanup();
  }
  const n = doc.numPages;
  await task.destroy();
  return { pages: n, sizes, textItems, annots };
}
