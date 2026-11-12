// Chapters, search and downloads with text (mock mode).
// - Chapters: read from the PDF's bookmarks on upload; the admin «Capítulos» panel (edit, add, read again from the PDF);
//   the reader's chapter list; downloading one chapter.
// - Search: accent- and case-insensitive, across a hyphenated line end, results with snippets, highlights on the page,
//   Ctrl+F, the phone sheet, no text when copying is off, access checks.
// - Downloads carry the text: a PDF built from page images has the book's text as an invisible layer (searchable), and
//   so does an OCR'd book's.
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/book-tools.mjs   (SCREENSHOTS=1 saves screenshots)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE, PW, SHOTS, adminApi, adminContext, context, counter, launch, sleep } from "./lib.mjs";
import { CHAPTERS, FIND, OCR_PAGES, accuracy, makeChaptersPdf, seedOcrBook, uploadPdf } from "./text-lib.mjs";

const pdfjs = await import(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
const t = counter("book-tools");
const shots = process.env.SCREENSHOTS === "1";
if (shots) fs.mkdirSync(SHOTS, { recursive: true });
const out = fs.mkdtempSync(path.join(os.tmpdir(), "libros-tools-"));
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();
const stamp = Date.now().toString(36);
const errors = [];
const bytes = await makeChaptersPdf();
const pdfFile = path.join(out, "capitulos.pdf");
fs.writeFileSync(pdfFile, bytes);

/** Every page's text of a PDF file, and where each text item is (fractions of the page, y from the top). */
async function pdfText(file) {
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const v = pg.getViewport({ scale: 1 });
    const items = (await pg.getTextContent()).items.filter((x) => x.str.trim()).map((x) => { const [px, py] = v.convertToViewportPoint(x.transform[4], x.transform[5]); return { s: x.str, x: px / v.width, y: py / v.height }; });
    pages.push({ text: items.map((x) => x.s).join(" ").replace(/\s+/g, " "), items });
  }
  await task.destroy();
  return pages;
}
const chaptersOf = async (id) => JSON.parse((await api("/api/admin/books")).json.books.find((b) => b.id === id).chapters || "[]");

// ================= 1. chapters from the bookmarks, on upload =================
const C = await uploadPdf(browser, { title: `Capítulos ${stamp}`, bytes, original: true }); // with the original PDF
const D = await uploadPdf(browser, { title: `Capítulos sin original ${stamp}`, bytes }); // built from page images when downloaded
await sleep(1000);
const auto = await chaptersOf(C.id);
t.check("upload: the PDF's bookmarks become the chapters (title and first page)", JSON.stringify(auto) === JSON.stringify(CHAPTERS), JSON.stringify(auto));
t.check("upload without the original: chapters too", (await chaptersOf(D.id)).length === 3);

// ================= 2. the admin «Capítulos» panel =================
{
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await a.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  const open = async (title) => {
    await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${title}`); await sleep(600);
    const row = p.locator("li[role=row]", { hasText: title });
    await row.getByRole("button", { name: "Capítulos", exact: true }).click();
    await p.waitForSelector("[data-testid=chapters-panel]");
    return row;
  };
  let row = await open(D.title);
  const titles = row.getByTestId("chapter-title"), pagesIn = row.getByTestId("chapter-page");
  t.check("panel: the saved chapters, with their pages and ranges", (await titles.count()) === 3 && (await titles.nth(1).inputValue()) === CHAPTERS[1].t && (await pagesIn.nth(2).inputValue()) === "9" && (await row.getByTestId("chapter-range").nth(1).innerText()) === "págs. 5–8");
  await titles.nth(1).fill("Capítulo 2. El largo viaje");
  await row.getByRole("button", { name: "Añadir capítulo" }).click();
  await titles.nth(3).fill("Epílogo");
  await pagesIn.nth(3).fill("12");
  await titles.nth(0).fill("");
  t.check("panel: an empty title is refused before saving", (await row.getByRole("button", { name: "Guardar" }).isDisabled()) && (await row.getByTestId("chapter-problem").first().innerText()) === "Escribe el título.");
  await titles.nth(0).fill(CHAPTERS[0].t);
  await pagesIn.nth(3).fill("9");
  t.check("panel: two chapters on one page are refused", await row.getByRole("button", { name: "Guardar" }).isDisabled());
  await pagesIn.nth(3).fill("12");
  if (shots) for (const th of ["light", "dark"]) {
    await p.evaluate((x) => { document.documentElement.dataset.theme = x; document.documentElement.style.colorScheme = x; }, th); await sleep(250);
    const b = await row.boundingBox(); const y = await p.evaluate(() => window.scrollY);
    await p.screenshot({ path: path.join(SHOTS, `chapters-admin-1440-${th}.png`), fullPage: true, clip: { x: 0, y: Math.max(0, b.y + y - 12), width: 1440, height: Math.min(1400, b.height + 24) } });
  }
  await row.getByRole("button", { name: "Guardar" }).click();
  await p.waitForSelector("text=Capítulos guardados");
  const saved = await chaptersOf(D.id);
  t.check("panel: saved (renamed, added «Epílogo» at page 12, sorted)", saved.length === 4 && saved[1].t === "Capítulo 2. El largo viaje" && saved[3].t === "Epílogo" && saved[3].p === 12, JSON.stringify(saved));
  // read them again from the PDF's bookmarks (a local file), then save
  await row.getByTestId("chapters-pdf").setInputFiles(pdfFile);
  await p.waitForSelector("[data-testid=chapters-note]");
  t.check("panel: «Leer» from a local PDF puts the 3 bookmarked chapters back in the form", (await titles.count()) === 3 && (await titles.nth(1).inputValue()) === CHAPTERS[1].t);
  await row.getByRole("button", { name: "Guardar" }).click();
  await p.waitForSelector("text=Capítulos guardados");
  t.check("panel: saved again as in the PDF", JSON.stringify(await chaptersOf(D.id)) === JSON.stringify(CHAPTERS));
  // the stored original works too
  row = await open(C.title);
  await row.getByRole("button", { name: "Leer del PDF original guardado" }).click();
  await p.waitForSelector("[data-testid=chapters-note]", { timeout: 30000 });
  t.check("panel: «Leer del PDF original guardado» reads the bookmarks of the stored original", (await row.getByTestId("chapter-title").count()) === 3);
  // API checks
  const raw = (path2, body) => fetch(BASE + path2, { method: "PUT", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
  t.check("chapters API: admin only (401)", (await raw(`/api/admin/books/${C.id}/chapters`, { chapters: [] })).status === 401);
  t.check("chapters API: a page past the end is refused", (await api(`/api/admin/books/${C.id}/chapters`, "PUT", { chapters: [{ t: "X", p: 13 }] })).status === 400);
  await a.close();
}

// ================= 3. the reader: chapters and search =================
const codeFor = async (id) => { const c = (await api(`/api/admin/books/${id}/codes`, "POST", { count: 1, label: "herramientas" })).json.codes[0]; return typeof c === "string" ? c : c.code ?? c.plain; };
const codeC = await codeFor(C.id);
async function reader({ w = 1440, h = 900, dark = false, touch = false, mode = "pdf", slug = C.slug, code = codeC } = {}) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  await c.addInitScript(({ mode, dark }) => { try { localStorage.setItem("br:mode", mode); localStorage.setItem("br:effect", "none"); localStorage.setItem("theme", dark ? "dark" : "light"); localStorage.setItem("br:cookies", "1"); } catch { /* ignore */ } }, { mode, dark });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${BASE}/b/${slug}?code=${code}#p=1`);
  await p.waitForSelector(mode === "pdf" ? "[data-page]" : "[data-unit]", { timeout: 30000 });
  await sleep(3000);
  return { c, p };
}
const pageShown = (p) => p.locator("#pagina").inputValue();
{
  const { c, p } = await reader();
  await p.getByTestId("chapters-open").click();
  const items = p.getByTestId("chapter-list").locator("button");
  t.check("reader: «Capítulos» lists the 3 chapters with their pages", (await items.count()) === 3 && (await items.nth(1).innerText()).includes(CHAPTERS[1].t) && (await items.nth(1).innerText()).includes("Pág. 5"));
  t.check("reader: the chapter being read is marked", (await items.nth(0).getAttribute("aria-current")) === "true");
  if (shots) await p.screenshot({ path: path.join(SHOTS, "chapters-reader-1440-light.png") });
  await items.nth(2).click();
  await sleep(1200);
  t.check("reader: a chapter opens on its first page", (await pageShown(p)) === "9", await pageShown(p));
  t.check("reader: now chapter 3 is marked", (await p.getByTestId("chapter-list").locator("button").nth(2).getAttribute("aria-current")) === "true");

  // search: Ctrl+F opens it with the field focused
  await p.mouse.click(720, 450);
  await p.keyboard.press("Control+f");
  await p.waitForSelector("[data-testid=search-panel]");
  t.check("search: Ctrl+F opens «Buscar» with the field focused", await p.evaluate(() => document.activeElement?.id === "buscar-libro"));
  t.check("search: one side panel at a time (the chapter list closed)", (await p.locator("aside[aria-label=Capítulos]").count()) === 0);
  await p.keyboard.type("aerodinamica");
  await p.waitForSelector("[data-testid=search-results]", { timeout: 15000 });
  const status = await p.getByTestId("search-status").innerText();
  t.check("search: without accents it finds «AERODINÁMICA» (1 result on page 7)", status === "1 resultado en 1 página" && (await p.getByTestId("search-results").locator("button").first().innerText()).includes("Pág. 7"), status);
  const mark = await p.getByTestId("search-snippet").first().locator("mark").innerText();
  t.check("search: the snippet marks the match", mark === "AERODINÁMICA", mark);
  if (shots) for (const th of ["light", "dark"]) {
    await p.evaluate((x) => { document.documentElement.dataset.theme = x; document.documentElement.style.colorScheme = x; }, th); await sleep(250);
    await p.screenshot({ path: path.join(SHOTS, `search-results-1440-${th}.png`) });
  }
  await p.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.style.colorScheme = "light"; });
  await p.getByTestId("search-results").locator("button").first().click();
  await sleep(1500);
  t.check("search: a result opens its page", (await pageShown(p)) === "7");
  await p.waitForSelector('[data-page="7"] [data-testid=search-marks] span', { timeout: 10000 });
  // the highlight sits on the word: it overlaps the text layer's span holding it
  const hit = await p.evaluate(() => {
    const m = document.querySelector('[data-page="7"] [data-testid=search-marks] span').getBoundingClientRect();
    const s = [...document.querySelectorAll('.text-layer[data-text-page="7"] span')].find((x) => x.textContent.includes("AERODINÁMICA"));
    if (!s) return null;
    const r = document.createRange(); const i = s.textContent.indexOf("AERODINÁMICA"); r.setStart(s.firstChild, i); r.setEnd(s.firstChild, i + 12);
    const w = r.getBoundingClientRect();
    return { dx: Math.abs(m.left - w.left), dw: Math.abs(m.width - w.width), dy: Math.abs(m.top - w.top), width: w.width };
  });
  t.check("search: the highlight covers the word on the page", hit && hit.dx < 0.15 * hit.width && hit.dw < 0.25 * hit.width && hit.dy < 8, JSON.stringify(hit));
  if (shots) { const b = await p.locator('[data-page="7"]').first().boundingBox(); await p.screenshot({ path: path.join(SHOTS, "search-highlight-1440.png"), clip: { x: b.x, y: Math.max(56, b.y), width: b.width, height: Math.min(560, 900 - Math.max(56, b.y)) } }); }
  // a word cut by a hyphen at a line end, and two pages
  await p.getByTestId("search-input").fill(FIND.split.word);
  await p.waitForFunction(() => /resultado/.test(document.querySelector("[data-testid=search-status]")?.textContent ?? ""), null, { timeout: 15000 });
  t.check("search: «velocidad» is found across «veloci-» / «dad»", (await p.getByTestId("search-status").innerText()) === "1 resultado en 1 página");
  await p.getByTestId("search-input").fill("BRUJULA");
  await p.waitForFunction(() => /2 resultados/.test(document.querySelector("[data-testid=search-status]")?.textContent ?? ""), null, { timeout: 15000 });
  t.check("search: upper case and no accent: «brújula» on pages 3 and 10", (await p.getByTestId("search-results").locator("button").allInnerTexts()).map((x) => x.split("\n")[0]).join(",").replace(/\s/g, "") === "Pág.3,Pág.10");
  await p.getByTestId("search-input").press("Enter");
  await sleep(1200);
  const first = await pageShown(p);
  await p.getByTestId("search-input").press("Enter");
  await sleep(1200);
  t.check("search: Intro goes from one result to the next", first === "3" && (await pageShown(p)) === "10", `${first} ${await pageShown(p)}`);
  await p.getByTestId("search-input").fill("cosmonauta");
  await p.waitForFunction(() => /No hay resultados/.test(document.querySelector("[data-testid=search-status]")?.textContent ?? ""), null, { timeout: 15000 });
  t.check("search: no results says so", (await p.getByTestId("search-status").innerText()) === "No hay resultados para «cosmonauta».");
  await p.getByRole("button", { name: "Cerrar la búsqueda" }).click();
  t.check("search: closing it removes the highlights", (await p.locator("[data-testid=search-marks]").count()) === 0);
  await c.close();
}
{ // Book mode: the highlight is drawn on the leaf too
  const { c, p } = await reader({ mode: "book" });
  await p.getByTestId("search-open").click();
  await p.getByTestId("search-input").fill("aerodinámica");
  await p.waitForSelector("[data-testid=search-results] button", { timeout: 15000 });
  await p.getByTestId("search-results").locator("button").first().click();
  await sleep(2000);
  t.check("Book mode: a result turns to its page and highlights the match", (await p.locator('.page-face[data-page="7"] [data-testid=search-marks] span').count()) >= 1);
  await c.close();
}
{ // phone: «Buscar» and «Capítulos» live in the ⋯ menu; a result closes the sheet and shows the page
  const { c, p } = await reader({ w: 390, h: 844, touch: true, mode: "book" });
  await p.getByRole("button", { name: "Más opciones" }).click();
  t.check("phone: «Buscar en el libro» and «Capítulos» are in the ⋯ menu", (await p.locator("#lector-menu").getByTestId("search-open").isVisible()) && (await p.locator("#lector-menu").getByTestId("chapters-open").isVisible()));
  await p.locator("#lector-menu").getByTestId("search-open").click();
  await p.getByTestId("search-input").fill("brújula");
  await p.waitForSelector("[data-testid=search-results] button", { timeout: 15000 });
  if (shots) await p.screenshot({ path: path.join(SHOTS, "search-phone-390-light.png") });
  await p.getByTestId("search-results").locator("button").nth(1).click();
  await sleep(1800);
  t.check("phone: a result closes the sheet and opens page 10 with the match", (await p.getByTestId("search-panel").count()) === 0 && (await pageShown(p)) === "10" && (await p.locator('.page-face[data-page="10"] [data-testid=search-marks] span').count()) >= 1, await pageShown(p));
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  t.check("phone: nothing overflows", sw <= 390, String(sw));
  await c.close();
}

// ================= 4. search: access and copying switched off =================
{
  const unlock = async (slug, code) => (await fetch(`${BASE}/api/books/${slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code }) })).headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const cookie = await unlock(C.slug, codeC);
  const s = (q, h = { cookie }) => fetch(`${BASE}/api/books/${C.slug}/search?q=${encodeURIComponent(q)}`, { headers: h });
  t.check("search API: without access -> 401", (await s("viaje", {})).status === 401);
  t.check("search API: one letter -> 400 with a message", (await s("v")).status === 400);
  const ok = await (await s("brujula")).json();
  t.check("search API: pages, counts, boxes and snippets", ok.total === 2 && ok.pages[0].page === 3 && ok.pages[0].boxes.length === 1 && ok.pages[0].snippet.text.includes("brújula"));
  await api(`/api/admin/books/${C.id}/text`, "POST", { action: "settings", allow_copy: false });
  await sleep(300);
  const off = await (await s("brujula")).json();
  t.check("copying off: search still finds the pages, with no text (no snippets)", off.total === 2 && off.pages.every((x) => x.snippet === undefined && x.boxes.length) && !JSON.stringify(off).includes("norte"), JSON.stringify(off).slice(0, 200));
  const { c, p } = await reader();
  await p.getByTestId("search-open").click();
  await p.getByTestId("search-input").fill("brujula");
  await p.waitForSelector("[data-testid=search-results] button", { timeout: 15000 });
  t.check("copying off: the reader lists pages and counts only", (await p.getByTestId("search-snippet").count()) === 0 && (await p.getByTestId("search-results").locator("button").first().innerText()).includes("1 coincidencia"));
  await c.close();
  await api(`/api/admin/books/${C.id}/text`, "POST", { action: "settings", allow_copy: true });
}

// ================= 5. downloads: a chapter, with the text =================
const username = `herr-${stamp}`.slice(0, 32);
{
  const made = (await api("/api/admin/users", "POST", { username, display_name: "Lectora herramientas", books: [C.id, D.id] })).json;
  await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
  await api(`/api/admin/users/${made.id}`, "PATCH", { can_download: true });
}
async function readerUser(slug) {
  const c = await context(browser, { w: 1440, h: 900, touch: false, saved: false, books: [] });
  await c.request.post(BASE + "/api/me/login", { data: { username, password: PW }, headers: { Origin: BASE } });
  await c.addInitScript(() => { try { localStorage.setItem("br:mode", "pdf"); } catch { /* ignore */ } });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${BASE}/b/${slug}#leer`);
  await p.waitForSelector("header[role=toolbar]", { timeout: 20000 });
  await sleep(2500);
  return { c, p };
}
const dialog = (p) => p.locator("dialog[open]");
for (const [B, kind] of [[D, "imagenes"], [C, "recorte"]]) {
  const { c, p } = await readerUser(B.slug);
  await p.getByTestId("download-open").first().click();
  await p.waitForSelector("dialog[open]");
  await dialog(p).getByTestId("dl-chapter").selectOption({ index: 1 });
  t.check(`${kind}: «Capítulo» picks a chapter (radio on, 4 pages)`, (await dialog(p).getByTestId("dl-chapter-radio").isChecked()) && (await dialog(p).getByTestId("dl-chapter").locator("option").nth(1).innerText()).includes("págs. 5–8"));
  await p.waitForFunction(() => document.querySelector("dialog[open] [data-testid=dl-method]")?.getAttribute("data-method"), null, { timeout: 15000 });
  const method = await dialog(p).getByTestId("dl-method").getAttribute("data-method");
  t.check(`${kind}: the method is «${kind}»${kind === "imagenes" ? " and says it carries the text" : ""}`, method === kind && (kind !== "imagenes" || (await dialog(p).getByTestId("dl-method").innerText()).includes("con su texto")), `${method} ${await dialog(p).getByTestId("dl-method").innerText()}`);
  if (shots && kind === "imagenes") await p.screenshot({ path: path.join(SHOTS, "download-chapter-1440-light.png") });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
  const file = path.join(out, `${kind}.pdf`);
  await dl.saveAs(file);
  t.check(`${kind}: the file is named after the chapter`, dl.suggestedFilename() === `${B.slug}-capitulo-2-el-viaje.pdf`, dl.suggestedFilename());
  const pages = await pdfText(file);
  t.check(`${kind}: 4 pages (5 to 8), each with its own text`, pages.length === 4 && pages.every((x, i) => x.text.includes(`Página ${5 + i} del libro`)), pages.map((x) => x.text.slice(0, 40)).join(" | "));
  if (kind === "imagenes") {
    t.check("imagenes: the text is searchable in the file (page 3 of it = book page 7)", pages[2].text.includes("AERODINÁMICA") && pages[2].text.includes("veloci-"));
    // the invisible text lies where the words are printed: "Página 5 del libro." starts at x = 70 pt
    const it = pages[0].items.find((x) => x.s.startsWith("Página 5"));
    t.check("imagenes: the text sits over the printed line (within 1 % of the page)", it && Math.abs(it.x - 70 / 595.28) < 0.01, JSON.stringify(it));
  }
  await p.waitForSelector("[data-testid=dl-done]", { timeout: 30000 });
  await c.close();
}

// ================= 6. an OCR'd book downloads with its recognised text =================
{
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await a.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  const title = `OCR descarga ${stamp}`;
  const ob = await seedOcrBook(p, title);
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${title}`); await sleep(600);
  const row = p.locator("li[role=row]", { hasText: title });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await row.getByRole("button", { name: "Reconocer texto (OCR)" }).click();
  await p.waitForSelector("text=Reconocimiento terminado", { timeout: 240000 });
  await sleep(800);
  await row.getByRole("button", { name: "Descargar", exact: true }).click();
  await p.waitForSelector("dialog[open]");
  await p.waitForFunction(() => /con su texto/.test(document.querySelector("dialog[open] [data-testid=dl-method]")?.textContent ?? ""), null, { timeout: 15000 });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
  const file = path.join(out, "ocr.pdf");
  await dl.saveAs(file);
  const pages = await pdfText(file);
  const acc = accuracy(pages[0].text.toLowerCase(), OCR_PAGES[0].join(" ").toLowerCase());
  t.check(`OCR'd book: the downloaded PDF has the recognised text (page 1: ${(acc * 100).toFixed(1)} %)`, pages.length === 5 && acc > 0.9, pages[0].text.slice(0, 120));
  t.check("OCR'd book: every page has text", pages.every((x) => x.text.length > 50));
  // and its text can be searched in the reader
  const cookie = (await fetch(`${BASE}/api/books/${ob.slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code: await codeFor(ob.id) }) })).headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const r = await (await fetch(`${BASE}/api/books/${ob.slug}/search?q=biblioteca`, { headers: { cookie } })).json();
  t.check("OCR'd book: search finds «biblioteca» on page 3", r.pages?.some((x) => x.page === 3), JSON.stringify(r).slice(0, 160));
  await a.close();
}

t.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
t.done();
