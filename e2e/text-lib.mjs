// Helpers for the text-layer tests (mock mode): a generated PDF with real Spanish text whose word positions are known,
// image pages with known text for OCR, and small text utilities.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BASE, adminApi, adminContext, sleep } from "./lib.mjs";

export const A4 = { w: 595.28, h: 841.89 };
/** The sentence the copy tests select: it spans two lines and one of its words is hyphenated at the line end. */
export const TARGET = "¿Quién le había enseñado a leer aquellas páginas tan extraordinariamente difíciles, llenas de señales y de nombres extraños?";
export const HEADING = "Capítulo primero. El pequeño lector de Logroño";

const PARAS = [
  "Cuando Íñigo Muñoz llegó a la estación de Logroño tenía siete años, una maleta de cartón y un cuaderno con las tapas azules. Nadie lo esperaba en el andén, pero él no parecía preocupado: se sentó en un banco, abrió el cuaderno y empezó a leer en voz baja.¹",
  `La señora del quiosco lo miró con curiosidad. ${TARGET} El niño levantó la vista, sonrió y siguió leyendo como si el ruido de los trenes no existiera.`,
  "¡Qué extraño era aquel muchacho! Pronunciaba cada palabra con cuidado, igual que quien cruza un río saltando de piedra en piedra, y cuando se equivocaba volvía al principio de la línea sin enfadarse.",
  "Años después, ya convertido en maestro, contaría que aprendió a leer con los carteles de las estaciones: Haro, Miranda, Pamplona, Tudela. Cada nombre era una pequeña victoria, y cada viaje, una página nueva del mismo libro.",
  "En el pueblo decían que tenía buena memoria, pero no era eso. Era paciencia: la paciencia de mirar una palabra hasta que deja de ser un dibujo y empieza a decir algo. ¿Acaso no es eso leer?",
  "La biblioteca municipal abría solo por las tardes. Íñigo llegaba el primero, saludaba al conserje, colgaba el abrigo en el mismo perchero y elegía siempre la mesa junto a la ventana, donde la luz caía sobre las hojas como un aviso de que el día aún no había terminado.",
  "Aquel invierno leyó cuentos, atlas, recetarios y hasta un manual de jardinería. No entendía todo, desde luego; sin embargo, descubrió que las palabras desconocidas también acompañan, como los vecinos a los que todavía no conoces por su nombre.",
  "Cuando por fin cumplió doce años, la bibliotecaria le dio un carné de adulto. Fue el regalo más importante de su vida, dijo muchas veces, más que la bicicleta y más que el reloj de su abuelo.",
];
const FOOT = "¹ Nota al pie: la estación de Logroño se trasladó en 2011; el antiguo edificio de ladrillo todavía conserva el reloj y los bancos de madera.";

/** Greedy wrap with simple hyphenation (long words are split with "-" at the end of a line). */
function wrap(text, font, size, width, indent) {
  const words = text.split(" ");
  const lines = [];
  let cur = "", first = true;
  const room = () => width - (first ? indent : 0);
  const fits = (s) => font.widthOfTextAtSize(s, size) <= room();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) { cur = next; continue; }
    if (w.length >= 9) {
      for (let k = w.length - 3; k >= 4; k--) {
        const head = `${cur ? cur + " " : ""}${w.slice(0, k)}-`;
        if (fits(head)) { lines.push({ s: head, first }); first = false; words[i] = w.slice(k); i--; cur = ""; break; }
        if (k === 4) { lines.push({ s: cur, first }); first = false; cur = w; }
      }
      continue;
    }
    lines.push({ s: cur, first }); first = false; cur = w;
  }
  if (cur) lines.push({ s: cur, first });
  return lines;
}

/**
 * An 8-page A4 PDF: a heading, two columns of body text (Times), a footnote (Helvetica) and a page number on every
 * page, except page `scanned`, which has only drawn shapes (like a scan: no text). Returns the bytes and, for every line
 * drawn, its text and box as fractions of the page, plus every word's box.
 */
export async function makeSpanishPdf({ pages = 8, scanned = 6 } = {}) {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const { w: W, h: H } = A4;
  const M = 56, GUT = 24, COLW = (W - 2 * M - GUT) / 2, SIZE = 11, LEAD = 14.2;
  const truth = [];
  // ascent of the standard fonts (units per em): Times 683, Helvetica 718 (cap height-ish tops of glyphs)
  const asc = { body: 0.683, bold: 0.718, sans: 0.718 };
  let para = 0;
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([W, H]);
    const lines = [];
    const draw = (s, x, base, font, size, key) => {
      page.drawText(s, { x, y: base, size, font, color: rgb(0.08, 0.08, 0.08) });
      const words = [];
      let at = 0;
      for (const part of s.split(" ")) {
        if (part) words.push({ s: part, x: (x + font.widthOfTextAtSize(s.slice(0, s.indexOf(part, at)), size)) / W, w: font.widthOfTextAtSize(part, size) / W });
        at = s.indexOf(part, at) + part.length;
      }
      lines.push({ s, x: x / W, top: (H - base - asc[key] * size) / H, w: font.widthOfTextAtSize(s, size) / W, size, words });
    };
    if (n === scanned) {
      // "scanned" page: a grey photo-like block and a few strokes, no text at all
      page.drawRectangle({ x: M, y: 140, width: W - 2 * M, height: H - 280, color: rgb(0.85, 0.85, 0.82) });
      for (let i = 0; i < 18; i++) page.drawLine({ start: { x: M + 20, y: 200 + i * 28 }, end: { x: W - M - 20 - (i % 4) * 40, y: 200 + i * 28 }, thickness: 3, color: rgb(0.35, 0.35, 0.35) });
      truth.push({ page: n, lines: [] });
      continue;
    }
    draw(n === 1 ? HEADING : `${n}. ${["Los nombres", "La biblioteca", "El invierno", "Las palabras", "", "El carné", "Epílogo"][n - 2] ?? "Sección"}`, M, H - 72, bold, n === 1 ? 17 : 15, "bold");
    let col = 0, base = H - 112;
    const bottom = 118;
    for (let k = 0; k < 2 * 22 && col < 2; ) {
      const text = PARAS[para % PARAS.length];
      const lines2 = wrap(text, body, SIZE, COLW, 12);
      // a paragraph is never split across columns: start a fresh column when it does not fit
      if (base - (lines2.length - 1) * LEAD < bottom) { col++; base = H - 112; if (col >= 2) break; }
      for (const l of lines2) { draw(l.s, M + col * (COLW + GUT) + (l.first ? 12 : 0), base, body, SIZE, "body"); base -= LEAD; k++; }
      base -= 5;
      para++;
    }
    page.drawLine({ start: { x: M, y: 100 }, end: { x: M + 120, y: 100 }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
    for (const [i, l] of wrap(FOOT, sans, 8, W - 2 * M, 0).entries()) draw(l.s, M, 88 - i * 10, sans, 8, "sans");
    draw(String(n), W / 2 - sans.widthOfTextAtSize(String(n), 9) / 2, 40, sans, 9, "sans");
    truth.push({ page: n, lines });
  }
  return { bytes: await doc.save(), truth, pages };
}

/** Known text drawn on plain images (for OCR): 5 pages, a heading and ~16 lines each, at 1400 px wide. */
export const OCR_PAGES = [
  ["La lectura en voz alta", "Cuando Íñigo leía en voz alta, su abuela dejaba", "de coser y escuchaba con los ojos cerrados.", "Decía que las palabras sonaban distintas en su", "boca, más despacio, como si pesaran un poco más.", "Él no sabía si eso era bueno o malo, pero seguía", "leyendo hasta que la luz de la cocina se apagaba."],
  ["El cuaderno azul", "En el cuaderno azul apuntaba los nombres de las", "estaciones, los ríos y los pueblos por los que", "pasaba el tren. Al lado de cada nombre dibujaba", "una pequeña señal: un árbol, un puente, una torre.", "Muchos años después aquel cuaderno seguía en su", "mesa, con las tapas gastadas y las hojas amarillas."],
  ["La biblioteca de Haro", "La biblioteca de Haro tenía un reloj que siempre", "iba diez minutos atrasado. Nadie lo arreglaba", "porque a todos les gustaba pensar que allí dentro", "el tiempo pasaba un poco más despacio que fuera.", "¿Quién iba a protestar por diez minutos más", "de lectura en una tarde tranquila de invierno?"],
  ["Las cartas del maestro", "El maestro escribía cartas largas a sus antiguos", "alumnos. Les preguntaba por sus familias, por sus", "trabajos y, sobre todo, por los libros que leían.", "¡Cuántas respuestas llegaron durante aquellos", "años! Algunas eran breves y otras ocupaban varias", "páginas llenas de recuerdos y de agradecimiento."],
  ["Epílogo junto al río", "Hoy la casa del maestro es una pequeña sala de", "lectura. Los niños del barrio entran después del", "colegio, eligen un libro y se sientan junto a la", "ventana que da al río. El conserje dice que el", "silencio que se forma allí es el mejor sonido", "del mundo, y nadie en el barrio le lleva la contraria."],
];

/** Levenshtein distance (characters). */
export function distance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** Character accuracy of `got` against `want` (whitespace collapsed): 1 - edit distance / length. */
export const accuracy = (got, want) => {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const g = norm(got), w = norm(want);
  return 1 - distance(g, w) / Math.max(1, w.length);
};

/** Uploads a PDF through the admin form (the normal upload flow) and returns the book. */
export async function uploadPdf(br, { title, bytes, original = false }) {
  const c = await adminContext(br, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  await p.goto(BASE + "/admin");
  await p.waitForSelector("#up-title");
  await sleep(800);
  await p.setInputFiles("#pdf-file", { name: `${title}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await p.fill("#up-title", title);
  const keep = p.locator("input[name=keep-original]");
  if (await keep.count()) await keep.setChecked(original);
  await p.getByRole("button", { name: "Subir libro" }).click();
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 180000 });
  if (original) await p.waitForSelector("text=PDF original guardado", { timeout: 180000 });
  await c.close();
  const a = adminApi();
  await a("/api/auth/login", "POST", { username: "admin", password: "admin123" });
  return (await a("/api/admin/books")).json.books.find((b) => b.title === title);
}

/** A published book made of images only (like a book uploaded from photos): OCR_PAGES drawn as text on white pages. */
export async function seedOcrBook(page, title) {
  await page.goto(BASE + "/icon.svg"); // no HMR client here: a mock-data write cannot reload the page mid-seed
  return page.evaluate(async ({ title, pages }) => {
    const j = async (u, m, b) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
    const { book } = await j("/api/admin/books", "POST", { title, page_count: pages.length });
    const draw = (lines) => {
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); c.width = 1400; c.height = 1980;
      const x = c.getContext("2d");
      // like a scan: off-white paper, speckles and a slight tilt
      x.fillStyle = "#f3efe6"; x.fillRect(0, 0, c.width, c.height);
      let seed = lines[0].length * 7919;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(60,50,40,${0.05 + rnd() * 0.2})`; x.fillRect(rnd() * c.width, rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2); }
      x.translate(c.width / 2, c.height / 2); x.rotate(0.006); x.translate(-c.width / 2, -c.height / 2);
      x.fillStyle = "#26231f"; x.textBaseline = "alphabetic";
      x.font = "bold 46px 'DejaVu Serif', serif"; x.fillText(lines[0], 130, 190);
      x.font = "36px 'DejaVu Serif', serif";
      lines.slice(1).forEach((l, i) => x.fillText(l, 130, 300 + i * 64));
      return new Promise((res) => c.toBlob(res, "image/webp", 0.92));
    };
    const all = [0, ...pages.map((_, i) => i + 1)];
    const { urls } = await j("/api/admin/upload-urls", "POST", { book_id: book.id, pages: all });
    for (const u of urls) {
      const blob = await draw(pages[(u.page || 1) - 1]);
      const r = await fetch(u.url, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" } });
      if (!r.ok) throw new Error("put " + r.status);
    }
    return (await j(`/api/admin/books/${book.id}/finalize`, "POST", { status: "published" })).book;
  }, { title, pages: OCR_PAGES });
}

/** Reads every stored text chunk of a book as the admin (through the admin "read" action). */
export async function readText(api, bookId, pageCount) {
  const out = {};
  for (let k = 0; k * 20 < pageCount; k++) {
    const r = await api(`/api/admin/books/${bookId}/text`, "POST", { action: "read", chunks: [k] });
    const url = r.json?.urls?.[0]?.url;
    if (!url) continue;
    const res = await fetch(new URL(url, BASE));
    if (!res.ok) continue;
    for (const p of (await res.json()).pages) out[p.n] = p;
  }
  return out;
}
