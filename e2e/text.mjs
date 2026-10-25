// Selectable text layer (mock mode): extraction while uploading, the reader's layer and copy rules, alignment,
// "Extraer texto", resume, OCR, the allow_copy switch, security and compatibility. Saves screenshots with SCREENSHOTS=1.
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/text.mjs
import fs from "node:fs";
import path from "node:path";
import { BASE, SHOTS, adminApi, adminContext, counter, launch, sleep } from "./lib.mjs";
import { OCR_PAGES, TARGET, accuracy, makeSpanishPdf, readText, seedOcrBook, uploadPdf } from "./text-lib.mjs";

const t = counter("text");
const shots = process.env.SCREENSHOTS === "1";
if (shots) fs.mkdirSync(SHOTS, { recursive: true });
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();
const stamp = Date.now().toString(36);
const report = {};
const { bytes, truth } = await makeSpanishPdf();
const raw = (p, init = {}) => fetch(BASE + p, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
const codeFor = async (id) => { const c = (await api(`/api/admin/books/${id}/codes`, "POST", { count: 1, label: "texto" })).json.codes[0]; return typeof c === "string" ? c : c.code ?? c.plain; };
const unlock = async (slug, code) => {
  const r = await fetch(`${BASE}/api/books/${slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code }) });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};

// ================= 1. a new PDF upload stores the text =================
const T1 = await uploadPdf(browser, { title: `Texto ES ${stamp}`, bytes, original: true });
const st1 = (await api(`/api/admin/books/${T1.id}/text`)).json;
t.check("upload: text stored as it uploads (status partial, 7 of 8 pages, page 6 has none)", st1.text_status === "partial" && st1.text_pages === 7 && st1.pages === "tttttstt" && st1.scanned === 1, JSON.stringify(st1));
const stored = await readText(api, T1.id, 8);
const p2 = stored[2];
t.check("chunk 0001-0020: every page, items {s,x,y,w,h,size} as fractions", Object.keys(stored).length === 8 && p2.src === "pdf" && p2.items.length > 40 && p2.items.every((i) => Object.keys(i).join() === "s,x,y,w,h,size" && i.x >= 0 && i.x < 1 && i.y >= 0 && i.y < 1 && i.w > 0 && i.w < 1));
t.check("lines merged: one item per printed line", p2.items.length === truth[1].lines.length, `${p2.items.length} vs ${truth[1].lines.length}`);
t.check("Spanish text kept exactly (accents, ñ, ¿¡, footnote mark)", p2.items.some((i) => i.s.startsWith("¿Quién le había enseñado")) && Object.values(stored).some((p) => p.items.some((i) => i.s.includes("¹"))) && Object.values(stored).some((p) => p.items.some((i) => i.s.startsWith("¡Qué extraño"))));

// ================= 2. security =================
const code1 = await codeFor(T1.id);
const cookie1 = await unlock(T1.slug, code1);
const r401 = await raw(`/api/books/${T1.slug}/text/0`);
const body401 = await r401.text();
t.check("text route signed out -> 401", r401.status === 401);
t.check("401 answer leaks no storage key", !/books\/[a-f0-9]{32}/.test(body401));
let other = null; // a published book without text (made before this feature)
for (const b of (await api("/api/admin/books")).json.books) {
  if (b.status === "published" && b.id !== T1.id && (await api(`/api/admin/books/${b.id}/text`)).json.text_pages === 0) { other = b; break; }
}
const otherCookie = await unlock(other.slug, await codeFor(other.id));
t.check("another book's code -> 401", (await raw(`/api/books/${T1.slug}/text/0`, { headers: { cookie: otherCookie } })).status === 401);
const ok1 = await raw(`/api/books/${T1.slug}/text/0`, { headers: { cookie: cookie1 } });
const okJson = await ok1.json();
t.check("with access -> 200 {url, expires_in: 60} and nothing else", ok1.status === 200 && Object.keys(okJson).join() === "url,expires_in" && okJson.expires_in === 60);
for (const bad of ["1", "99", "abc", "-1", "01"]) t.check(`chunk "${bad}" -> 404`, (await raw(`/api/books/${T1.slug}/text/${bad}`, { headers: { cookie: cookie1 } })).status === 404);
const chunkRaw = await (await fetch(new URL(okJson.url, BASE))).text();
t.check("chunk JSON holds only text and boxes (no keys, no prefixes)", !/books\/|storage|prefix|cover/.test(chunkRaw) && /^\{"v":1,"pages":\[/.test(chunkRaw));
t.check("tampered presigned URL -> 403", (await fetch(new URL(okJson.url.replace(/s=[^&]+/, "s=AAAA"), BASE))).status === 403);
t.check("book page HTML holds no storage prefix", !/books\/[a-f0-9]{32}/.test(await (await raw(`/b/${T1.slug}`)).text()));
t.check("admin text routes need the admin: 401", (await raw(`/api/admin/books/${T1.id}/text`)).status === 401 && (await raw("/api/admin/text")).status === 401 && (await raw(`/api/admin/books/${T1.id}/text`, { method: "POST", body: JSON.stringify({ action: "finish" }), headers: { Origin: BASE } })).status === 401);
const adminCookie = (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: "admin", password: "admin123" }) })).headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
t.check("admin POST from another site -> 403", (await raw(`/api/admin/books/${T1.id}/text`, { method: "POST", body: JSON.stringify({ action: "finish" }), headers: { cookie: adminCookie, Origin: "https://evil.example" } })).status === 403);
t.check("the existing pages route answers as before", (await (await raw(`/api/books/${T1.slug}/pages/1`, { headers: { cookie: cookie1 } })).json()).expires_in === 60);

// ================= reader helpers =================
async function reader({ w, h, mode, dark = false, touch = false, effect = "none", slug = T1.slug, code = code1, hash = "#p=2" }) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch, colorScheme: dark ? "dark" : "light" });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await c.addInitScript(({ mode, dark, effect }) => { try { localStorage.setItem("br:mode", mode); localStorage.setItem("br:effect", effect); localStorage.setItem("theme", dark ? "dark" : "light"); localStorage.removeItem("br:select"); } catch { /* ignore */ } }, { mode, dark, effect });
  const p = await c.newPage();
  const textReqs = [];
  p.on("request", (r) => { if (/\/api\/books\/[^/]+\/text\//.test(r.url())) textReqs.push(r.url()); });
  await p.goto(`${BASE}/b/${slug}?code=${code}${hash}`);
  await p.waitForSelector(mode === "pdf" ? "[data-page]" : "[data-unit]", { timeout: 30000 });
  await sleep(4200);
  return { c, p, textReqs };
}
const layer = (n) => `.text-layer[data-text-page="${n}"]`;
/** Viewport points at the start of `from` and at the end of `to` (texts of page n's layer). */
async function sentenceBox(p, n, from, to) {
  return p.evaluate(({ sel, from, to }) => {
    const spans = [...document.querySelectorAll(`${sel} span`)];
    const a = spans.find((s) => s.textContent.includes(from));
    const b = spans.slice(spans.indexOf(a)).find((s) => s.textContent.includes(to));
    const rect = (span, i) => { const r = document.createRange(); r.setStart(span.firstChild, i); r.setEnd(span.firstChild, i + 1); return r.getBoundingClientRect(); };
    const ra = rect(a, a.textContent.indexOf(from)), rb = rect(b, b.textContent.indexOf(to) + to.length - 1);
    return { x0: ra.left + ra.width * 0.2, y0: ra.top + ra.height / 2, x1: rb.right - rb.width * 0.2, y1: rb.top + rb.height / 2 };
  }, { sel: layer(n), from, to });
}
async function dragSelect(p, b) {
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
const startOf = TARGET.slice(0, 6), endOf = TARGET.slice(-9); // "¿Quién" ... "extraños?"
/** Average and worst distance between where each printed word is and where its text is in the layer (% of page width). */
async function alignment(p, pages) {
  return p.evaluate(({ pages }) => {
    const dx = [], dy = [];
    for (const { n, lines } of pages) {
      const img = document.querySelector(`[data-page="${n}"] canvas`);
      const L = document.querySelector(`.text-layer[data-text-page="${n}"]`);
      if (!img || !L) continue;
      const box = img.getBoundingClientRect();
      const spans = [...L.querySelectorAll("span")];
      for (const line of lines) {
        // the same line can be printed twice on a page (the paragraphs repeat): take the copy nearest to where it is printed
        let span = null, best = Infinity;
        for (const s of spans) {
          if (s.textContent !== line.s) continue;
          const r = s.getBoundingClientRect();
          const d = Math.abs((r.left - box.left) / box.width - line.x) + Math.abs((r.top - box.top) / box.height - line.top);
          if (d < best) { best = d; span = s; }
        }
        if (!span) continue;
        let at = 0;
        for (const w of line.words) {
          const i = line.s.indexOf(w.s, at); at = i + w.s.length;
          const r = document.createRange(); r.setStart(span.firstChild, i); r.setEnd(span.firstChild, i + w.s.length);
          const b = r.getBoundingClientRect();
          dx.push(Math.abs((b.left - box.left) / box.width - w.x));
        }
        const sb = span.getBoundingClientRect();
        dy.push(Math.abs((sb.top - box.top) / box.width - line.top * (box.height / box.width)));
      }
    }
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)) * 100;
    return { words: dx.length, dxAvg: avg(dx), dxMax: Math.max(...dx) * 100, dyAvg: avg(dy) };
  }, { pages });
}
const truthOf = (...ns) => ns.map((n) => ({ n, lines: truth[n - 1].lines }));
const red = (p) => p.addStyleTag({ content: ".text-layer span { color: rgba(220,0,0,.8) !important; }" });
/** Screenshot of an element (page coordinates, so it may be taller than the window). */
async function shootEl(p, loc, file, w) {
  const b = await loc.boundingBox();
  const y = await p.evaluate(() => window.scrollY);
  await p.screenshot({ path: path.join(SHOTS, file), fullPage: true, clip: { x: 0, y: Math.max(0, b.y + y - 12), width: w, height: Math.min(1600, b.height + 24) } });
}
const setTheme = (p, theme) => p.evaluate((th) => { document.documentElement.dataset.theme = th; document.documentElement.style.colorScheme = th; }, theme);

// ================= 3. PDF mode: copy, alignment =================
{
  const { c, p } = await reader({ w: 1440, h: 900, mode: "pdf" });
  t.check("PDF mode: a text layer over the pages on screen", (await p.locator(layer(2)).count()) === 1);
  t.check("UI chrome is still not selectable", (await p.evaluate(() => getComputedStyle(document.querySelector("[role=toolbar] h1")).userSelect)) === "none");
  await dragSelect(p, await sentenceBox(p, 2, startOf, endOf));
  const got = await copied(p);
  t.check("PDF mode: drag-select one sentence + Ctrl+C = exactly that sentence", got === TARGET, JSON.stringify(got));
  // a hyphenated line end is joined: last word of a line ending in "-" + first word of the next line
  const hy = await p.evaluate((sel) => {
    const spans = [...document.querySelectorAll(`${sel} span`)];
    const k = spans.findIndex((s, i) => s.textContent.endsWith("-") && spans[i + 1]);
    const a = spans[k], b = spans[k + 1];
    const wa = a.textContent.split(" ").pop(), wb = b.textContent.split(" ")[0];
    const r = document.createRange();
    r.setStart(a.firstChild, a.textContent.length - wa.length); r.setEnd(b.firstChild, wb.length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    return wa.slice(0, -1) + wb;
  }, layer(2));
  t.check(`hyphenated line end joined on copy ("${hy}")`, (await copied(p)) === hy);
  // the context menu is allowed on the text, still blocked elsewhere
  const cm = await p.evaluate((sel) => {
    const ev = (el) => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
    return { text: ev(document.querySelector(`${sel} span`)), page: ev(document.querySelector("[data-page] canvas")) };
  }, layer(2));
  t.check("context menu: allowed on the text layer, blocked on the page image", cm.text === false && cm.page === true);
  const blocked = await p.evaluate(() => { const r = {}; for (const k of ["s", "p"]) { const e = new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); r[k] = e.defaultPrevented; } return r; });
  t.check("Ctrl+S and Ctrl+P still blocked", blocked.s && blocked.p);
  t.check("printing still hides everything", await p.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media?.mediaText === "print" && /display:\s*none/.test(r.cssText)); } catch { return false; } })));
  if (shots) {
    await dragSelect(p, await sentenceBox(p, 2, startOf, endOf));
    for (const th of ["light", "dark"]) { await setTheme(p, th); await sleep(200); await p.screenshot({ path: path.join(SHOTS, `text-pdf-selection-1440-${th}.png`) }); }
    await setTheme(p, "light");
  }
  // alignment: "Ajustar al ancho" (default), then 100 %
  const fitA = await alignment(p, truthOf(2, 3));
  report.alignFit = fitA;
  t.check(`alignment at "Ajustar al ancho": ${fitA.dxAvg.toFixed(2)} % of page width on average (${fitA.words} words)`, fitA.words > 300 && fitA.dxAvg < 1, JSON.stringify(fitA));
  if (shots) { await red(p); await sleep(150); const b = await p.locator('[data-page="2"]').first().boundingBox(); await p.screenshot({ path: path.join(SHOTS, "text-align-fit-width.png"), clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 760) } }); await p.reload(); await p.waitForSelector(layer(2)); await sleep(2500); }
  for (let i = 0; i < 6 && (await p.locator("[aria-live=polite].tnum").first().innerText()) !== "100%"; i++) { await p.getByRole("button", { name: "Reducir zoom" }).first().click(); await sleep(400); }
  const pct = await p.locator("[aria-live=polite].tnum").first().innerText();
  await sleep(1500);
  const z100 = await alignment(p, truthOf(2));
  report.align100 = z100;
  t.check(`alignment at 100 % zoom: ${z100.dxAvg.toFixed(2)} % of page width on average`, pct === "100%" && z100.words > 150 && z100.dxAvg < 1, `${pct} ${JSON.stringify(z100)}`);
  if (shots) { await red(p); await sleep(150); const b = await p.locator('[data-page="2"]').first().boundingBox(); await p.screenshot({ path: path.join(SHOTS, "text-align-100.png"), clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 760) } }); }
  await c.close();
}
for (const dark of [false, true]) { // phone, PDF mode: a selection (set as a long-press would) and its highlight
  const { c, p } = await reader({ w: 390, h: 844, mode: "pdf", dark, touch: true });
  await p.evaluate(({ sel, from, to }) => {
    const spans = [...document.querySelectorAll(`${sel} span`)];
    const a = spans.find((s) => s.textContent.includes(from)); const z = spans.slice(spans.indexOf(a)).find((s) => s.textContent.includes(to));
    const r = document.createRange(); r.setStart(a.firstChild, a.textContent.indexOf(from)); r.setEnd(z.firstChild, z.textContent.indexOf(to) + to.length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }, { sel: layer(2), from: startOf, to: endOf });
  if (!dark) t.check("phone, PDF mode: copying a selection gives the sentence", (await copied(p)) === TARGET);
  if (shots) { await sleep(200); await p.screenshot({ path: path.join(SHOTS, `text-pdf-selection-390-${dark ? "dark" : "light"}.png`) }); }
  await c.close();
}

// ================= 4. Book mode: "Seleccionar texto" =================
{
  const { c, p } = await reader({ w: 1440, h: 900, mode: "book", effect: "turn" });
  const unit = () => p.locator("[data-unit]").first().getAttribute("data-unit");
  const u0 = await unit();
  t.check("Book mode (spread 2–3): layers only on the two pages on screen", (await p.locator(".text-layer").count()) === 2 && (await p.locator(layer(2)).count()) === 1 && (await p.locator(layer(3)).count()) === 1);
  t.check('"Seleccionar texto" (I-beam) next to the mode switch, off', (await p.getByTestId("select-text").getAttribute("aria-pressed")) === "false");
  // off: a drag turns the page and selects nothing
  const bx = await sentenceBox(p, 2, startOf, endOf);
  await p.mouse.move(1100, bx.y0); await p.mouse.down(); await p.mouse.move(500, bx.y0, { steps: 12 }); await p.mouse.up(); await sleep(1500);
  t.check("toggle off: dragging turns the page, nothing selected", (await unit()) !== u0 && (await p.evaluate(() => getSelection().toString())) === "", `${u0} -> ${await unit()}`);
  await p.keyboard.press("ArrowLeft"); await sleep(1200);
  await p.getByTestId("select-text").click();
  t.check('toggle on: aria-pressed and "Seleccionar texto"', (await p.getByTestId("select-text").getAttribute("aria-pressed")) === "true" && (await p.getByTestId("select-text").getAttribute("aria-label")) === "Seleccionar texto");
  await dragSelect(p, await sentenceBox(p, 2, startOf, endOf));
  t.check("toggle on: the drag did not turn the page", (await unit()) === u0);
  const got = await copied(p);
  t.check('Book mode + "Seleccionar texto": the copied text is exactly the sentence', got === TARGET, JSON.stringify(got));
  const sp = await alignment(p, truthOf(2, 3));
  report.alignSpread = sp;
  t.check(`alignment in a spread: ${sp.dxAvg.toFixed(2)} % of page width on average`, sp.words > 300 && sp.dxAvg < 1, JSON.stringify(sp));
  if (shots) {
    for (const th of ["light", "dark"]) { await setTheme(p, th); await sleep(200); await p.screenshot({ path: path.join(SHOTS, `text-book-select-1440-${th}.png`) }); }
    await setTheme(p, "light");
    await red(p); await sleep(150); await p.screenshot({ path: path.join(SHOTS, "text-align-spread.png") });
  }
  await p.keyboard.press("ArrowRight"); await sleep(1200);
  t.check("toggle on: the arrows still turn pages", (await unit()) !== u0);
  await c.close();
}
// phone, Book mode: a quick swipe turns; while text is selected (long-press) swipe-to-turn waits
for (const dark of [false, true]) {
  const { c, p } = await reader({ w: 390, h: 844, mode: "book", dark, touch: true, effect: "slide" });
  const cdp = await c.newCDPSession(p);
  const unit = () => p.locator("[data-unit]").first().getAttribute("data-unit");
  const swipe = async () => {
    const pts = [[320, 450], [260, 452], [190, 455], [120, 456], [60, 458]];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (const [x, y] of pts.slice(1)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(1300);
  };
  if (!dark) {
    t.check('phone: no "Seleccionar texto" button (long-press selects)', !(await p.getByTestId("select-text").isVisible()));
    const u0 = await unit();
    await swipe();
    const u1 = await unit();
    t.check("phone: a quick swipe turns the page", u1 !== u0, `${u0} -> ${u1}`);
    await p.evaluate(() => { const s = document.querySelector(".text-layer span"); const r = document.createRange(); r.selectNodeContents(s); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await swipe();
    t.check("phone: while text is selected, a swipe does not turn", (await unit()) === u1);
    await p.evaluate(() => getSelection().removeAllRanges());
    await swipe();
    t.check("phone: selection cleared, swipes turn again", (await unit()) !== u1);
  }
  if (shots) {
    await p.evaluate(({ from, to }) => {
      const spans = [...document.querySelectorAll(".text-layer span")];
      const a = spans.find((s) => s.textContent.includes(from)) ?? spans[3]; const z = spans.slice(spans.indexOf(a)).find((s) => s.textContent.includes(to)) ?? spans[6];
      const r = document.createRange(); r.setStart(a.firstChild, Math.max(0, a.textContent.indexOf(from))); r.setEnd(z.firstChild, z.textContent.includes(to) ? z.textContent.indexOf(to) + to.length : z.textContent.length);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    }, { from: startOf, to: endOf });
    await sleep(200);
    await p.screenshot({ path: path.join(SHOTS, `text-book-select-390-${dark ? "dark" : "light"}.png`) });
  }
  await c.close();
}

// ================= 5. allow_copy off =================
{
  const a = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await a.newPage();
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${T1.title}`); await sleep(600);
  const row = p.locator("li[role=row]", { hasText: T1.title });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await p.waitForSelector("[data-testid=text-panel]");
  t.check('admin: status "Parcial", "7 de 8 páginas con texto", "1 página sin texto (escaneadas)"', (await p.getByTestId("text-status").innerText()) === "Parcial" && (await row.innerText()).includes("7 de 8 páginas con texto") && (await p.getByTestId("ocr-count").innerText()) === "1 página sin texto (escaneadas)");
  t.check('admin: "Permitir seleccionar y copiar texto" is on by default', await p.getByTestId("allow-copy").isChecked());
  if (shots) {
    const panel = p.getByTestId("text-panel");
    for (const [w, th] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
      await p.setViewportSize({ width: w, height: 900 }); await setTheme(p, th); await sleep(300);
      await panel.scrollIntoViewIfNeeded();
      await shootEl(p, row, `text-admin-switch-${w}-${th}.png`, w);
    }
    await p.setViewportSize({ width: 1280, height: 900 }); await setTheme(p, "light");
  }
  await p.getByTestId("allow-copy").click();
  await p.waitForSelector("text=Los lectores ya no pueden seleccionar ni copiar el texto");
  t.check("switch off: stored as allow_copy = false", (await api(`/api/admin/books/${T1.id}/text`)).json.allow_copy === false);
  await sleep(300);
  {
    const { c, p: r, textReqs } = await reader({ w: 1440, h: 900, mode: "pdf" });
    t.check("allow_copy off: no text layer and no text request", (await r.locator(".text-layer").count()) === 0 && textReqs.length === 0, textReqs.join());
    t.check("allow_copy off: the text route says 404", (await raw(`/api/books/${T1.slug}/text/0`, { headers: { cookie: cookie1 } })).status === 404);
    await r.mouse.move(700, 300); await r.mouse.down(); await r.mouse.move(900, 420, { steps: 10 }); await r.mouse.up();
    await r.keyboard.press("Control+A");
    t.check("allow_copy off: copying does nothing", (await copied(r)) === "(vacío)");
    await c.close();
  }
  await p.getByTestId("allow-copy").click();
  // (the panel's own hint has the same words and shows at once with the switch: wait for the save itself)
  let saved = false;
  for (let i = 0; i < 40 && !saved; i++) { saved = (await api(`/api/admin/books/${T1.id}/text`)).json.allow_copy === true; if (!saved) await sleep(250); }
  t.check("switch on again: allow_copy = true", saved);
  await a.close();
}

// ================= 6. a book without text works exactly as before =================
{
  const plainBook = (await api("/api/admin/books")).json.books.find((b) => b.id === other.id);
  const { c, p, textReqs } = await reader({ w: 1440, h: 900, mode: "book", slug: plainBook.slug, code: await codeFor(plainBook.id), hash: "#p=1" });
  const u0 = await p.locator("[data-unit]").first().getAttribute("data-unit");
  await p.keyboard.press("ArrowRight"); await sleep(1200);
  t.check("book without text: no text layer, no text request, no toggle, pages turn", (await p.locator(".text-layer").count()) === 0 && textReqs.length === 0 && (await p.getByTestId("select-text").count()) === 0 && (await p.locator("[data-unit]").first().getAttribute("data-unit")) !== u0);
  t.check("book without text: the reader still grabs to turn (cursor)", (await p.evaluate(() => getComputedStyle(document.querySelector("[data-renders].absolute")).cursor)) === "grab");
  await c.close();
}

// ================= 7. "Extraer texto" =================
{
  const a = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await a.newPage();
  const ranges = [];
  p.on("request", (r) => { if (r.url().includes("original.pdf") && r.headers().range) ranges.push(r.headers().range); });
  // an existing book with no text and no stored original: from a local file
  const NOTEXT = `Sin texto ${stamp}`;
  const nb = await (async () => { const sp = await a.newPage(); const { seedBook } = await import("./dl-lib.mjs"); const b = await seedBook(sp, { title: NOTEXT, pages: 8, w: 1400, hOf: () => Math.round(1400 * 841.89 / 595.28) }); await sp.close(); return b; })();
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${NOTEXT}`); await sleep(600);
  let row = p.locator("li[role=row]", { hasText: NOTEXT });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await p.waitForSelector("[data-testid=text-panel]");
  t.check('existing book: "Sin texto", "8 páginas sin texto" and OCR offered', (await p.getByTestId("text-status").innerText()) === "Sin texto" && (await p.getByTestId("ocr-count").innerText()) === "8 páginas sin texto");
  const five = (await makeSpanishPdf({ pages: 5 })).bytes;
  await row.locator("input[type=file]").setInputFiles({ name: "otro.pdf", mimeType: "application/pdf", buffer: Buffer.from(five) });
  await p.waitForSelector("text=Este PDF tiene 5 páginas y el libro tiene 8. Tiene que ser el mismo PDF.", { timeout: 30000 });
  t.check("Extraer texto: a page-count mismatch is refused (and nothing is stored)", (await api(`/api/admin/books/${nb.id}/text`)).json.pages === "--------");
  await row.locator("input[type=file]").setInputFiles({ name: "libro.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await p.waitForFunction(() => document.querySelector("[data-testid=text-status]")?.textContent === "Parcial", null, { timeout: 60000 });
  const sn = (await api(`/api/admin/books/${nb.id}/text`)).json;
  t.check('Extraer texto from a local file: "Parcial", 7 pages, page 6 scanned', sn.text_status === "partial" && sn.text_pages === 7 && sn.pages === "tttttstt", JSON.stringify(sn));
  // the book with a stored original: "Volver a extraer" reads it with Range requests
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${T1.title}`); await sleep(600);
  row = p.locator("li[role=row]", { hasText: T1.title });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await p.waitForSelector("[data-testid=text-panel]");
  await row.getByRole("button", { name: "Volver a extraer" }).click();
  await p.waitForSelector("text=Texto extraído: 7 de 8 páginas", { timeout: 60000 });
  t.check("Volver a extraer from the stored original: done, with Range requests through presigned URLs", ranges.length >= 1 && ranges.every((r) => /^bytes=\d+-\d+$/.test(r)), ranges.slice(0, 3).join(" "));
  t.check("after re-extraction: still Parcial, 7 pages", (await api(`/api/admin/books/${T1.id}/text`)).json.text_pages === 7);
  // the book used by the performance test gets its text too (it was uploaded before this feature)
  const perf = (await api("/api/admin/books")).json.books.find((b) => b.title === "Texto de prueba (rendimiento)");
  if (perf) {
    await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${perf.title}`); await sleep(600);
    const pr = p.locator("li[role=row]", { hasText: perf.title });
    await pr.getByRole("button", { name: "Texto", exact: true }).click();
    await p.waitForSelector("[data-testid=text-panel]");
    if ((await p.getByTestId("text-status").innerText()) === "Sin texto") {
      await pr.locator("input[type=file]").setInputFiles({ name: "rendimiento.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
      await p.waitForFunction(() => document.querySelector("[data-testid=text-status]")?.textContent === "Parcial", null, { timeout: 60000 });
    }
  }
  await a.close();
}

// ================= 8. resume also tracks the text chunks =================
{
  // a real file on disk: resuming checks name, size and last-modified date, so it must be the very same file
  const bigFile = path.join(fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "libros-")), "reanudar.pdf");
  fs.writeFileSync(bigFile, (await makeSpanishPdf({ pages: 30 })).bytes);
  const a = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await a.newPage();
  await p.route("**/api/storage/local*", async (r) => { if (r.request().method() === "PUT") await sleep(120); await r.continue(); });
  await p.goto(BASE + "/admin"); await p.waitForSelector("#up-title"); await sleep(600);
  const title = `Reanudar texto ${stamp}`;
  await p.setInputFiles("#pdf-file", bigFile);
  await p.fill("#up-title", title);
  await p.locator("input[name=keep-original]").setChecked(false);
  await p.getByRole("button", { name: "Subir libro" }).click();
  await p.waitForFunction(() => { const m = /^(\d+) \/ 30/.exec(document.querySelector("[data-testid=progress]")?.textContent ?? ""); return m && Number(m[1]) >= 22; }, null, { timeout: 60000, polling: 20 });
  await p.getByRole("button", { name: "Cancelar" }).first().click();
  await p.waitForSelector("text=Subida cancelada", { timeout: 30000 });
  const rb = (await api("/api/admin/books")).json.books.find((b) => b.title === title);
  const mid = (await api(`/api/admin/books/${rb.id}/text`)).json;
  t.check("interrupted upload: the first chunk of text is stored, the second is not", mid.pages.slice(0, 20).replace(/[ts]/g, "").length === 0 && /^-+$/.test(mid.pages.slice(20)), mid.pages);
  await p.reload(); await p.waitForSelector(`text=${title}`); await sleep(600);
  const row = p.locator("li[role=row]", { hasText: title });
  await row.getByRole("button", { name: "Continuar subida" }).click();
  const writes = [];
  p.on("request", (r) => { if (r.method() === "PUT" && decodeURIComponent(r.url()).includes("/text/")) writes.push(decodeURIComponent(r.url()).match(/text\/(\d{4}-\d{4})/)[1]); });
  await row.locator("input[type=file]").setInputFiles(bigFile);
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 120000 });
  const end = (await api(`/api/admin/books/${rb.id}/text`)).json;
  t.check("resumed upload: only the missing chunk is written again", writes.join() === "0021-0040", writes.join());
  t.check("resumed upload: text for all 30 pages (29 with text, page 6 scanned)", end.text_pages === 29 && !end.pages.includes("-"), JSON.stringify(end));
  await a.close();
}

// ================= 9. OCR =================
{
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await a.newPage();
  const title = `OCR ${stamp}`;
  const ob = await seedOcrBook(p, title);
  // page images a little slower, so the progress, the pause and the screenshots happen while it runs
  await p.route("**/api/storage/local*", async (r) => { if (r.request().url().includes(".webp")) await sleep(900); await r.continue(); });
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${title}`); await sleep(600);
  const row = p.locator("li[role=row]", { hasText: title });
  await row.getByRole("button", { name: "Texto", exact: true }).click();
  await p.waitForSelector("[data-testid=ocr-box]");
  t.check('image book: "5 páginas sin texto" and "Reconocer texto (OCR)" right away', (await p.getByTestId("ocr-count").innerText()) === "5 páginas sin texto" && (await row.getByRole("button", { name: "Reconocer texto (OCR)" }).count()) === 1);
  // responsiveness: longest gap between animation frames while OCR runs
  await p.evaluate(() => { const w = window; w.__gap = 0; let last = performance.now(); const f = (t) => { w.__gap = Math.max(w.__gap, t - last); last = t; if (!w.__stopGap) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await row.getByRole("button", { name: "Reconocer texto (OCR)" }).click();
  await p.waitForFunction(() => /^Reconociendo texto: 1 \/ 5/.test(document.querySelector("[data-testid=ocr-progress] p")?.textContent ?? ""), null, { timeout: 60000 });
  const tClick = await p.evaluate(async () => { const t0 = performance.now(); document.querySelector("[aria-label='Cambiar a tema oscuro'], [aria-label='Cambiar a tema claro']")?.click(); await new Promise((r) => requestAnimationFrame(() => r())); return performance.now() - t0; });
  await p.evaluate(() => document.querySelector("[aria-label='Cambiar a tema oscuro'], [aria-label='Cambiar a tema claro']")?.click());
  t.check("OCR shows progress and time left", /Reconociendo texto: 1 \/ 5 páginas · 20 % · quedan \d+ s/.test(await p.getByTestId("ocr-progress").innerText()), await p.getByTestId("ocr-progress").innerText());
  if (shots) {
    for (const [w, th] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
      await p.setViewportSize({ width: w, height: 900 }); await setTheme(p, th); await sleep(250);
      await p.getByTestId("ocr-box").scrollIntoViewIfNeeded();
      await shootEl(p, row, `text-admin-ocr-${w}-${th}.png`, w);
    }
    await p.setViewportSize({ width: 1440, height: 900 }); await setTheme(p, "light");
  }
  await row.getByRole("button", { name: "Pausar" }).click();
  await p.waitForSelector("button:has-text('Reanudar')", { timeout: 30000 });
  const paused = (await api(`/api/admin/books/${ob.id}/text`)).json;
  const donePaused = (paused.pages.match(/o/g) ?? []).length;
  t.check(`pause: stops, ${donePaused} of 5 pages kept, "Reanudar" offered`, donePaused >= 1 && donePaused < 5 && paused.text_status === "partial", paused.pages);
  const gap = await p.evaluate(() => { window.__stopGap = true; return window.__gap; });
  report.ocrLongestFrameGapMs = Math.round(gap);
  report.ocrClickToPaintMs = Math.round(tClick);
  t.check(`the admin page stays responsive during OCR (longest frame gap ${Math.round(gap)} ms, a click painted in ${Math.round(tClick)} ms)`, gap < 400 && tClick < 200);
  const reqs = [];
  p.on("request", (r) => { if (r.url().includes("/page-urls")) reqs.push(r.postDataJSON()?.pages?.[0]); });
  await row.getByRole("button", { name: "Reanudar" }).click();
  await p.waitForFunction(() => document.querySelector("[data-testid=text-status]")?.textContent === "Completo", null, { timeout: 120000 });
  t.check("resume: only the pages not yet recognised are done", reqs.length === 5 - donePaused && reqs[0] === donePaused + 1, JSON.stringify(reqs));
  const text = await readText(api, ob.id, 5);
  const accs = OCR_PAGES.map((lines, i) => accuracy((text[i + 1]?.items ?? []).map((x) => x.s).join(" "), lines.join(" ")));
  const acc = accs.reduce((x, y) => x + y, 0) / accs.length;
  report.ocrAccuracy = Number((acc * 100).toFixed(2));
  report.ocrPerPage = accs.map((x) => Number((x * 100).toFixed(1)));
  t.check(`OCR character accuracy ${(acc * 100).toFixed(1)} % (>= 90 %), word boxes stored as "ocr"`, acc >= 0.9 && text[1].src === "ocr" && text[1].items.length > 30);
  // the reader gets the recognised words as its layer
  const { c, p: r } = await reader({ w: 1440, h: 900, mode: "pdf", slug: ob.slug, code: await codeFor(ob.id), hash: "#p=1" });
  t.check("reader: the recognised text is selectable", (await r.locator(`${layer(1)} span`).count()) > 30);
  await r.evaluate((sel) => { const spans = [...document.querySelectorAll(`${sel} span`)]; const a = spans.find((s) => s.textContent === "Cuando"); const z = spans.find((s) => s.textContent === "dejaba"); const g = document.createRange(); g.setStart(a.firstChild, 0); g.setEnd(z.firstChild, z.textContent.length); getSelection().removeAllRanges(); getSelection().addRange(g); }, layer(1));
  const ocrCopy = await copied(r);
  t.check("reader: copying recognised words joins them with spaces", ocrCopy === "Cuando Íñigo leía en voz alta, su abuela dejaba", JSON.stringify(ocrCopy));
  await c.close();
  await a.close();
}

await browser.close();
console.log("\nREPORT " + JSON.stringify(report));
t.done();
