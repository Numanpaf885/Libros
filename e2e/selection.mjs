// Text selection on a page with margin material (mock mode): a textbook page with a rotated side title in a margin
// tab, a running header, a footer and page number, a boxed note, a heading and two columns (makeMarginPdf). Selecting
// body text selects only that text, in reading order; rotated text is never selected or copied; margin text only from
// a drag that starts on it. Also: the stored format (r, ver), old chunks without them, the admin notice and
// "Volver a extraer", and OCR of the same page (the side tab's noise stays out of the body).
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/selection.mjs   (SCREENSHOTS=1 saves screenshots)
import fs from "node:fs";
import path from "node:path";
import { BASE, SHOTS, adminApi, adminContext, counter, launch, sleep } from "./lib.mjs";
import { A4, MARGIN, accuracy, makeMarginPdf, readText, uploadPdf } from "./text-lib.mjs";
// the pure helpers, for the hand-made OCR checks (Node strips the types itself from 22.18 on)
const tl = await import("../lib/text-layer.ts").catch(() => null);

const t = counter("selection");
const shots = process.env.SCREENSHOTS === "1";
if (shots) fs.mkdirSync(SHOTS, { recursive: true });
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();
const stamp = Date.now().toString(36);
const { bytes, truth } = await makeMarginPdf();
const errors = [];
const codeFor = async (id) => { const c = (await api(`/api/admin/books/${id}/codes`, "POST", { count: 1, label: "seleccion" })).json.codes[0]; return typeof c === "string" ? c : c.code ?? c.plain; };
const putChunk = async (id, json) => {
  const { urls } = (await api(`/api/admin/books/${id}/text`, "POST", { action: "urls", chunks: [0] })).json;
  const r = await fetch(new URL(urls[0].url, BASE), { method: "PUT", body: JSON.stringify(json), headers: { "Content-Type": "application/json" } });
  if (!r.ok) throw new Error("put chunk " + r.status);
};

// ================= 1. the stored format =================
const N = await uploadPdf(browser, { title: `Márgenes ${stamp}`, bytes, original: true });
const stored = await readText(api, N.id, 2);
const rot = stored[1]?.items.find((i) => i.r !== undefined);
t.check("new chunk: the rotated side title is kept, with r = 90", rot?.s === MARGIN.side && rot.r === 90 && Object.keys(rot).join() === "s,x,y,w,h,size,r", JSON.stringify(rot));
t.check("new chunk: horizontal items carry no r (the format is unchanged for them)", Object.values(stored).every((p) => p.items.filter((i) => i !== rot).every((i) => Object.keys(i).join() === "s,x,y,w,h,size")));
t.check("new chunk: every page says it was read with rotations (ver 2)", stored[1]?.ver === 2 && stored[2]?.ver === 2 && stored[1].src === "pdf");

// ================= reader helpers =================
async function reader(slug, code, { dark = false, w = 1440, h = 900 } = {}) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light" });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await c.addInitScript(({ dark }) => { try { localStorage.setItem("br:mode", "pdf"); localStorage.setItem("theme", dark ? "dark" : "light"); localStorage.setItem("br:cookies", "1"); } catch { /* ignore */ } }, { dark });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${BASE}/b/${slug}?code=${code}#p=1`);
  await p.waitForSelector('.text-layer[data-text-page="1"]', { timeout: 30000 });
  await sleep(2500);
  return { c, p };
}
const layer = (n) => `.text-layer[data-text-page="${n}"]`;
/** Viewport points at the start of `from` and the end of `to` (the first span holding `to` after the one holding `from`). */
const wordsBox = (p, n, from, to) => p.evaluate(({ sel, from, to }) => {
  const spans = [...document.querySelectorAll(`${sel} span`)];
  const a = spans.find((s) => s.textContent.includes(from));
  const b = spans.slice(spans.indexOf(a)).find((s) => s.textContent.includes(to));
  const rect = (span, i) => { const r = document.createRange(); r.setStart(span.firstChild, i); r.setEnd(span.firstChild, i + 1); return r.getBoundingClientRect(); };
  const ra = rect(a, a.textContent.indexOf(from)), rb = rect(b, b.textContent.indexOf(to) + to.length - 1);
  return { x0: ra.left + ra.width * 0.2, y0: ra.top + ra.height / 2, x1: rb.right - rb.width * 0.2, y1: rb.top + rb.height / 2 };
}, { sel: layer(n), from, to });
async function drag(p, b) {
  await p.mouse.move(b.x0, b.y0);
  await p.mouse.down();
  await p.mouse.move((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, { steps: 8 });
  await p.mouse.move(b.x1, b.y1, { steps: 8 });
  await p.mouse.up();
  await sleep(150);
}
async function copied(p) {
  await p.evaluate(() => navigator.clipboard.writeText("(vacío)"));
  await p.keyboard.press("Control+C");
  await sleep(150);
  return p.evaluate(() => navigator.clipboard.readText());
}
/** What the selection's ranges touch in page n's layer: the texts of body spans and of margin spans. */
const touched = (p, n) => p.evaluate((sel) => {
  const s = getSelection(), body = [], margin = [];
  for (let k = 0; k < s.rangeCount; k++) {
    const r = s.getRangeAt(k);
    for (const span of document.querySelectorAll(`${sel} span`)) if (r.intersectsNode(span)) (span.closest(".text-margin") ? margin : body).push(span.textContent);
  }
  return { body, margin };
}, layer(n));
/** The page image's box and the side tab's box on screen (from where it is printed). */
const tabClip = async (p, n) => {
  const b = await p.locator(`[data-page="${n}"] canvas`).first().boundingBox();
  const tb = truth[n - 1].tab;
  return { x: b.x + Math.max(0, tb.x - 0.02) * b.width, y: b.y + (tb.y - 0.02) * b.height, width: (tb.w + 0.04) * b.width, height: (tb.h + 0.04) * b.height };
};
/** Brings page n on screen (the reader mounts pages near the view only): scrolls down until it is there. */
const show = async (p, n) => {
  await p.mouse.move(720, 500);
  for (let k = 0; k < 30 && !(await p.locator(`${layer(n)} span`).count()); k++) { await p.mouse.wheel(0, 500); await sleep(250); }
  await p.locator(`[data-page="${n}"]`).first().scrollIntoViewIfNeeded();
  await p.waitForSelector(`${layer(n)} span`, { timeout: 15000 });
  await sleep(700);
};
/** Scrolls the reader so that the span holding `text` on page n is `y` px from the top of the window. */
const scrollToText = async (p, n, text, y) => {
  await p.evaluate(({ sel, text, y }) => {
    const s = [...document.querySelectorAll(`${sel} span`)].find((x) => x.textContent.includes(text));
    let el = s.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    (el ?? document.scrollingElement).scrollBy(0, s.getBoundingClientRect().top - y);
  }, { sel: layer(n), text, y });
  await sleep(500);
};

// ================= 2. the reader, page 1: rotated side title =================
const codeN = await codeFor(N.id);
{
  const { c, p } = await reader(N.slug, codeN);
  const st = await p.evaluate((sel) => {
    const L = document.querySelector(sel), m = L.querySelector(".text-margin"), rot = L.querySelector(".tl-rot");
    const kids = [...L.children].filter((k) => !k.classList.contains("tl-end")); // the selection guard (see lib/client/text.ts)
    return {
      marginLast: kids[kids.length - 1] === m && kids.slice(0, -1).every((k) => k.tagName === "SPAN"),
      margin: [...m.querySelectorAll("span")].map((s) => s.textContent),
      rotSelect: rot && getComputedStyle(rot).userSelect, rotPointer: rot && getComputedStyle(rot).pointerEvents, rotText: rot?.textContent,
      firstBody: L.querySelector(":scope > span")?.textContent,
    };
  }, layer(1));
  t.check("layer: body spans first, then one margin container at the end", st.marginLast && st.firstBody === MARGIN.heading, JSON.stringify(st));
  t.check("margin container: running header, side title, page number and footer (nothing else)", [MARGIN.header, MARGIN.side, MARGIN.pageNo, MARGIN.footer].every((s) => st.margin.includes(s)) && st.margin.length === 4, JSON.stringify(st.margin));
  t.check("rotated side title: user-select none, no pointer events", st.rotText === MARGIN.side && st.rotSelect === "none" && st.rotPointer === "none", JSON.stringify(st));
  // the rotated span covers the printed vertical text
  const al = await p.evaluate(({ sel, W }) => {
    const img = document.querySelector('[data-page="1"] canvas').getBoundingClientRect(), r = document.querySelector(`${sel} .tl-rot`).getBoundingClientRect();
    return { x: (r.left - img.left) / img.width, y: (r.top - img.top) / img.height, w: r.width / img.width, h: r.height / img.height, W };
  }, { sel: layer(1), W: A4.w });
  const tab = truth[0].tab;
  const off = { x: Math.abs(al.x - tab.x), y: Math.abs(al.y - tab.y), len: Math.abs(al.h - tab.h), thick: Math.abs(al.w - 13 / A4.w) };
  t.check(`rotated side title lines up with the print (off by x ${(off.x * 100).toFixed(2)} %, y ${(off.y * 100).toFixed(2)} %, length ${(off.len * 100).toFixed(2)} %)`, off.x < 0.006 && off.y < 0.006 && off.len < 0.006 && off.thick < 0.006, JSON.stringify({ al, tab }));

  // the note paragraph, first word to last word
  const before = await p.screenshot({ clip: await tabClip(p, 1) });
  await drag(p, await wordsBox(p, 1, "Recuerda:", "velocidad."));
  const tn = await touched(p, 1);
  const got = await copied(p);
  t.check("note: the clipboard is exactly the paragraph", got === MARGIN.note, JSON.stringify(got));
  t.check("note: no selected range touches the side title, the header, the footer or the page number", tn.margin.length === 0, JSON.stringify(tn.margin));
  t.check("note: the ranges touch only the note's lines", tn.body.length === 3 && tn.body.every((s) => MARGIN.note.includes(s)), JSON.stringify(tn.body));
  const after = await p.screenshot({ clip: await tabClip(p, 1) });
  t.check("note: the side title shows no highlight (its pixels do not change)", before.equals(after));
  if (shots) {
    for (const th of ["light", "dark"]) {
      await p.evaluate((x) => { document.documentElement.dataset.theme = x; document.documentElement.style.colorScheme = x; }, th);
      await sleep(250);
      await p.screenshot({ path: path.join(SHOTS, `selection-note-1440-${th}.png`) });
    }
    await p.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.style.colorScheme = "light"; });
  }

  // columns and blocks
  await drag(p, await wordsBox(p, 1, "El ángulo", "pérdida."));
  const c1 = await copied(p);
  t.check("column 1 dragged top to bottom: exactly column 1, nothing of column 2", c1 === MARGIN.col1, JSON.stringify(c1));
  await drag(p, await wordsBox(p, 1, "La densidad", "peso."));
  t.check("column 2 dragged top to bottom: exactly column 2", (await copied(p)) === MARGIN.col2);
  await drag(p, await wordsBox(p, 1, "2.1", "avión."));
  const hp = await copied(p);
  t.check("heading into the paragraph: the heading, then the paragraph", hp === `${MARGIN.heading}\n${MARGIN.intro}`, JSON.stringify(hp));
  // a selection that runs over the whole layer (as select-all would) still never copies the rotated title or the margin
  const all = await p.evaluate((sel) => { const L = document.querySelector(sel), r = document.createRange(); r.selectNodeContents(L); getSelection().removeAllRanges(); getSelection().addRange(r); }, layer(1)).then(() => copied(p));
  t.check("whole layer selected: body in reading order, no side title, no header or footer", all.startsWith(MARGIN.heading) && all.endsWith(MARGIN.col2) && !all.includes("AERODIN") && !all.includes(MARGIN.header) && !all.includes(MARGIN.footer), JSON.stringify(all.slice(-80)));

  // margin text: selectable from a drag that starts on it, and that drag stays in the margin
  await p.evaluate(() => getSelection().removeAllRanges());
  const hb = await p.evaluate((sel) => { const s = [...document.querySelectorAll(`${sel} .text-margin span`)].find((x) => x.textContent === "UNIDAD 2"); const r = s.getBoundingClientRect(); return { x0: r.left + 1, y0: r.top + r.height / 2, x1: r.right - 1, y1: r.top + r.height / 2 }; }, layer(1));
  await drag(p, hb);
  t.check("running header: a drag that starts on it selects it", (await copied(p)) === MARGIN.header);
  const into = await wordsBox(p, 1, "Un avión", "llamada");
  await drag(p, { x0: hb.x0, y0: hb.y0, x1: into.x1, y1: into.y1 });
  const hm = await copied(p);
  t.check("running header: a drag from it into the body stays in the margin", hm.includes(MARGIN.header) && !/avión|sustentación aparece/.test(hm), JSON.stringify(hm));
  await scrollToText(p, 1, "ala entra en pérdida.", 120);
  const end = await wordsBox(p, 1, "ala entra", "pérdida.");
  const pn = await p.evaluate((sel) => { const s = [...document.querySelectorAll(`${sel} .text-margin span`)].find((x) => x.textContent === "37"); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, layer(1));
  await drag(p, { x0: end.x0, y0: end.y0, x1: pn.x, y1: pn.y });
  const tp = await touched(p, 1), cp = await copied(p);
  t.check("a drag from the body onto the page number never selects it", pn.y < 890 && !tp.margin.length && !cp.includes(MARGIN.footer) && !cp.includes(MARGIN.pageNo), JSON.stringify({ y: pn.y, margin: tp.margin, cp }));
  if (shots) { // the debug overlay: the layer in red over the page, the rotated title over the printed one
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.addStyleTag({ content: ".text-layer span { color: rgba(220,0,0,.85) !important; }" });
    await scrollToText(p, 1, MARGIN.header, 110);
    const b = await p.locator('[data-page="1"] canvas').first().boundingBox();
    await p.screenshot({ path: path.join(SHOTS, "selection-debug-overlay-1440.png"), clip: { x: b.x, y: Math.max(56, b.y), width: b.width, height: 900 - Math.max(56, b.y) } });
  }

  // ================= 3. page 2: the side title as upright letters, every line in printed order =================
  await show(p, 2);
  await drag(p, await wordsBox(p, 2, "Recuerda:", "velocidad."));
  const t2 = await touched(p, 2);
  t.check("page 2 (letters, rows in printed order): the note copies exactly, no letter of the side title touched", (await copied(p)) === MARGIN.note && t2.margin.length === 0, JSON.stringify(t2.margin));
  await drag(p, await wordsBox(p, 2, "El ángulo", "pérdida."));
  t.check("page 2: column 1 copies exactly", (await copied(p)) === MARGIN.col1);
  t.check("page 2: the 18 letters are in the margin container", (await p.locator(`${layer(2)} .text-margin span`).count()) === truth[1].letters.length + 3);
  await c.close();
}

// ================= 4. an old chunk (before r and ver) =================
const O = await uploadPdf(browser, { title: `Márgenes antiguo ${stamp}`, bytes, original: true });
{
  const now = await readText(api, O.id, 2);
  // what the extractor stored before: no ver, no r, rotated text left out
  const old = { v: 1, pages: Object.values(now).map((pg) => ({ n: pg.n, src: pg.src, items: pg.items.filter((i) => i.r === undefined) })) };
  await putChunk(O.id, old);
  const back = await readText(api, O.id, 2);
  t.check("old chunk stored (no ver, no r, no rotated item)", back[1].ver === undefined && back[1].items.every((i) => i.r === undefined) && !back[1].items.some((i) => i.s === MARGIN.side));
  const { c, p } = await reader(O.slug, await codeFor(O.id));
  t.check("old chunk: the layer renders", (await p.locator(`${layer(1)} span`).count()) === back[1].items.length && (await p.locator(`${layer(1)} .tl-rot`).count()) === 0);
  await drag(p, await wordsBox(p, 1, "Recuerda:", "velocidad."));
  t.check("old chunk: the note selects and copies as before", (await copied(p)) === MARGIN.note && (await touched(p, 1)).margin.length === 0);
  await show(p, 2);
  await drag(p, await wordsBox(p, 2, "Recuerda:", "velocidad."));
  t.check("old chunk, page 2: the side title's letters are not selected any more", (await copied(p)) === MARGIN.note && (await touched(p, 2)).margin.length === 0);
  await c.close();
}
{ // admin: the notice, then "Volver a extraer"
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await a.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  const panel = async (title) => {
    await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${title}`); await sleep(600);
    const row = p.locator("li[role=row]", { hasText: title });
    await row.getByRole("button", { name: "Texto", exact: true }).click();
    await p.waitForSelector("[data-testid=text-panel]");
    await sleep(1500);
    return row;
  };
  let row = await panel(O.title);
  const note = p.getByTestId("text-old");
  t.check("admin Texto: old text shows «Vuelve a extraer el texto para mejorar la selección»", (await note.count()) === 1 && (await note.innerText()) === "Vuelve a extraer el texto para mejorar la selección.");
  if (shots) for (const th of ["light", "dark"]) {
    await p.evaluate((x) => { document.documentElement.dataset.theme = x; document.documentElement.style.colorScheme = x; }, th); await sleep(250);
    const b = await row.boundingBox(); const y = await p.evaluate(() => window.scrollY);
    await p.screenshot({ path: path.join(SHOTS, `selection-admin-notice-1440-${th}.png`), fullPage: true, clip: { x: 0, y: Math.max(0, b.y + y - 12), width: 1440, height: Math.min(1200, b.height + 24) } });
  }
  await row.getByRole("button", { name: "Volver a extraer" }).click();
  await p.waitForSelector("text=Texto extraído: 2 de 2 páginas", { timeout: 60000 });
  await sleep(1500);
  const re = await readText(api, O.id, 2);
  t.check("after «Volver a extraer»: the chunk has r (the side title) and ver 2", re[1].ver === 2 && re[1].items.some((i) => i.s === MARGIN.side && i.r === 90));
  t.check("after «Volver a extraer»: the notice is gone", (await p.getByTestId("text-old").count()) === 0);
  row = await panel(N.title);
  t.check("a book extracted with this version shows no notice", (await p.getByTestId("text-old").count()) === 0);
  await a.close();
}

// ================= 5. OCR: tesseract's reading of the side tab stays out of the body =================
{
  // rules of itemsFromOcr on hand-made tesseract output (image 1000 x 1400)
  if (!tl) console.log("  (skipped: the hand-made OCR checks need Node 22.18 or later to load lib/text-layer.ts)");
  else {
  const { itemsFromOcr, pageLayout } = tl;
  const w = (text, x0, y0, x1, y1, confidence = 95) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
  const ln = (words, base) => ({ bbox: { x0: Math.min(...words.map((x) => x.bbox.x0)), y0: Math.min(...words.map((x) => x.bbox.y0)), x1: Math.max(...words.map((x) => x.bbox.x1)), y1: Math.max(...words.map((x) => x.bbox.y1)) }, baseline: base, words });
  const blocks = [
    { blocktype: 1, paragraphs: [{ lines: [
      ln([w("o", 20, 300, 34, 330, 70), w("Hola", 150, 300, 210, 324), w("mundo", 222, 300, 300, 324), w("xq", 310, 300, 330, 324, 12)], { x0: 20, y0: 320, x1: 330, y1: 320 }),
      ln([w("torcida", 150, 400, 260, 450)], { x0: 150, y0: 440, x1: 260, y1: 410 }),
      ln([w("AERODINAMICA", 30, 500, 50, 800)], { x0: 40, y0: 800, x1: 41, y1: 500 }),
    ] }] },
    { blocktype: 7, paragraphs: [{ lines: [ln([w("BASICA", 30, 900, 120, 920)], { x0: 30, y0: 920, x1: 120, y1: 920 })] }] },
  ];
  const items = itemsFromOcr(blocks, 1000, 1400);
  const s = items.map((i) => i.s);
  t.check("OCR: a vertical block, a tilted line and an upright stack of letters are left out", !s.includes("BASICA") && !s.includes("torcida") && !s.includes("AERODINAMICA"), JSON.stringify(s));
  t.check("OCR: a very-low-confidence word is left out", !s.includes("xq"));
  const hola = items.find((i) => i.s === "Hola"), o = items.find((i) => i.s === "o");
  t.check("OCR: a word glued to the line from the margin gets its own box (the line keeps its height)", o && hola && Math.abs(hola.h - 24 / 1400) < 1e-4 && Math.abs(o.h - 30 / 1400) < 1e-4, JSON.stringify(items));
  const L = pageLayout([...items, { s: "Una línea larga del cuerpo del texto", x: 0.15, y: 0.3, w: 0.6, h: 0.017, size: 0.017 }, { s: "y otra línea larga del cuerpo", x: 0.15, y: 0.32, w: 0.55, h: 0.017, size: 0.017 }, { s: "y una tercera, también larga", x: 0.15, y: 0.34, w: 0.5, h: 0.017, size: 0.017 }], 1.4);
  t.check("OCR: the margin word is margin text in the layer", L.kind[items.indexOf(o)] === 1);
  }

  // the real thing: the test page's image (page 1, rotated side title) as an image book, recognised in the admin
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await a.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(BASE + "/icon.svg");
  const title = `OCR márgenes ${stamp}`;
  const ob = await p.evaluate(async ({ title, src }) => {
    const j = async (u, m, b) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
    const pageUrl = (await j(`/api/admin/books/${src}/page-urls`, "POST", { pages: [1] })).urls[0].url;
    const img = await (await fetch(pageUrl)).blob();
    const { book } = await j("/api/admin/books", "POST", { title, page_count: 1 });
    const { urls } = await j("/api/admin/upload-urls", "POST", { book_id: book.id, pages: [0, 1] });
    for (const u of urls) { const r = await fetch(u.url, { method: "PUT", body: img, headers: { "Content-Type": "image/webp" } }); if (!r.ok) throw new Error("put " + r.status); }
    return (await j(`/api/admin/books/${book.id}/finalize`, "POST", { status: "published" })).book;
  }, { title, src: N.id });
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${title}`); await sleep(600);
  const row = p.locator("li[role=row]", { hasText: title });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await row.getByRole("button", { name: "Reconocer texto (OCR)" }).click();
  await p.waitForSelector("text=Reconocimiento terminado", { timeout: 180000 });
  const ocr = (await readText(api, ob.id, 1))[1];
  t.check("OCR page stored with ver 2", ocr?.src === "ocr" && ocr.ver === 2 && ocr.items.length > 100);
  await a.close();
  const { c, p: r } = await reader(ob.slug, await codeFor(ob.id));
  const noise = await r.evaluate((sel) => [...document.querySelectorAll(`${sel} .text-margin span`)].filter((s) => s.getBoundingClientRect().left - document.querySelector('[data-page="1"] canvas').getBoundingClientRect().left < 70).map((s) => s.textContent), layer(1));
  await drag(r, await wordsBox(r, 1, "Recuerda:", "velocidad."));
  const on = await touched(r, 1), oc = await copied(r);
  const acc = accuracy(oc.toLowerCase(), MARGIN.note.toLowerCase());
  t.check(`OCR: the note copies without the side tab's noise (accuracy ${(acc * 100).toFixed(1)} %, tab noise in the margin: ${JSON.stringify(noise)})`, acc > 0.97 && on.margin.length === 0 && on.body.every((s) => MARGIN.note.toLowerCase().includes(s.toLowerCase())), JSON.stringify({ oc, margin: on.margin, body: on.body.filter((s) => !MARGIN.note.toLowerCase().includes(s.toLowerCase())) }));
  await drag(r, await wordsBox(r, 1, "El", "pérdida."));
  const ocol = await copied(r);
  t.check("OCR: column 1 copies without column 2 (tesseract read both columns as one line)", accuracy(ocol, MARGIN.col1) > 0.95 && !/densidad|caluroso/.test(ocol), JSON.stringify(ocol));
  await c.close();
}

t.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
t.done();
