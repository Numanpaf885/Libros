// Copies what the admin OCR tool ("Reconocer texto (OCR)") needs from node_modules into public/ocr/, so this site serves
// it itself (no CDN): tesseract.js's worker, the LSTM builds of its WebAssembly core (the worker picks the one the browser
// supports) and the Spanish and English language data (tessdata "best_int", from @tesseract.js-data/spa and /eng).
// Runs after `npm install` and before `npm run build`. Files that are already there with the same size are skipped.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "ocr");
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz", "lang/spa.traineddata.gz"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];
let copied = 0;
for (const [from, to] of files) {
  const src = path.join(root, from);
  const dst = path.join(out, to);
  if (!fs.existsSync(src)) {
    console.warn(`[ocr] missing ${from}: OCR will not be available until \`npm install\` has run`);
    continue;
  }
  if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
if (copied) console.log(`[ocr] copied ${copied} file(s) to public/ocr`);
