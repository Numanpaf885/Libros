// Size of the JavaScript the reader page (/b/[slug]) loads, from the last `npm run build`, and whether pdf.js or
// tesseract.js are in it. Run after a build:  node e2e/bundle-size.mjs   (--json for a machine-readable line)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const NEXT = path.join(process.cwd(), ".next");
const read = (p) => fs.readFileSync(path.join(NEXT, p));
globalThis.self = globalThis;
(0, eval)(read("server/app/b/[slug]/page_client-reference-manifest.js").toString());
const m = globalThis.__RSC_MANIFEST["/b/[slug]/page"];
const page = [...new Set(m.entryJSFiles["[project]/app/b/[slug]/page"] ?? [])];
const build = JSON.parse(read("build-manifest.json").toString());
const root = [...new Set([...(build.rootMainFiles ?? []), ...(build.polyfillFiles ?? [])])];
const all = [...new Set([...root, ...page])];
const size = (files) => files.reduce((a, f) => { const b = read(f); return { raw: a.raw + b.length, gz: a.gz + zlib.gzipSync(b, { level: 9 }).length }; }, { raw: 0, gz: 0 });
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const hits = (re) => all.filter((f) => re.test(read(f).toString()));
const p = size(page), t = size(all);
const pdfjs = hits(/GlobalWorkerOptions|PDFDataRangeTransport|pdfjs-dist/);
const tess = hits(/tesseract/i);
console.log(`reader page chunks: ${page.length} files, ${kb(p.raw)} (${kb(p.gz)} gzip)`);
console.log(`reader total incl. framework: ${all.length} files, ${kb(t.raw)} (${kb(t.gz)} gzip)`);
console.log(`pdf.js in reader chunks: ${pdfjs.length ? "YES " + pdfjs.join(", ") : "no"}`);
console.log(`tesseract.js in reader chunks: ${tess.length ? "YES " + tess.join(", ") : "no"}`);
if (process.argv.includes("--json")) console.log(JSON.stringify({ pageRaw: p.raw, pageGz: p.gz, totalRaw: t.raw, totalGz: t.gz, pdfjs: pdfjs.length, tesseract: tess.length }));
