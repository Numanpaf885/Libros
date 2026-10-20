// Admin and reader PDF downloads in a real browser (mock mode): range, 500 pages + heap, cancel, closing the tab,
// the reader button (desktop toolbar and phone menu) and the log screen.
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/downloads-ui.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PW, SHOTS, adminApi, context } from "./lib.mjs";
import { BASE, adminContext, counter, ensureBook, launch, seedBook, sleep } from "./dl-lib.mjs";
import { inspectPdf } from "./pdf-check.mjs";

const t = counter("downloads-ui");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "libros-dl-"));
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const stamp = Date.now().toString(36);
const hOf = (n) => 1900 + (n % 9) * 10; // identifies each page by its height
const BIG = "Libro de 500 páginas (prueba de descargas)";

// ---------- seed ----------
const seedCtx = await adminContext(browser, { w: 1000, h: 700, touch: false });
const sp = await seedCtx.newPage();
await sp.goto(BASE + "/admin");
console.log("seeding books (the 500-page one is created once and reused)...");
const big = await ensureBook(sp, api, { title: BIG, pages: 500, w: 1400, hOf, rich: true });
const small = await seedBook(sp, { title: `DL lector ${stamp}`, pages: 14, w: 800, hOf: (n) => 1000 + n * 10 });
const odd = await seedBook(sp, { title: `DL impar ${stamp}`, pages: 7, w: 800, hOf: (n) => 1000 + n * 10 });
await seedCtx.close();
console.log("seeded:", big.slug, small.slug);

const rowOf = (p, title) => p.locator("li", { hasText: title }).first();
async function openDialog(p, title) {
  await rowOf(p, title).getByRole("button", { name: "Descargar", exact: true }).click();
  await p.waitForSelector("dialog[open]");
}
const dialog = (p) => p.locator("dialog[open]");
async function setRange(p, a, b) {
  await dialog(p).getByLabel("Desde la página").fill(String(a));
  await dialog(p).getByLabel("Hasta la página").fill(String(b));
}
const logRows = async () => (await api("/api/admin/downloads?size=50")).json.rows;
const waitLog = async (id, status, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) { const r = (await logRows()).find((x) => x.id === id); if (r?.status === status) return r; await sleep(200); }
  return (await logRows()).find((x) => x.id === id);
};
const lastLog = async (pred) => (await logRows()).find(pred);

// ================= admin: validation and a 3-7 range =================
{
  const c = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  await p.goto(BASE + "/admin");
  await p.waitForSelector(`text=${BIG}`);
  t.check("books have a Descargar action", (await rowOf(p, BIG).getByRole("button", { name: "Descargar", exact: true }).count()) === 1);
  await openDialog(p, BIG);
  const submit = dialog(p).getByRole("button", { name: "Descargar PDF" });
  t.check("dialog: Todo el libro is the default, button enabled", await submit.isEnabled());
  await dialog(p).getByLabel("Desde la página").fill("0");
  t.check("range 0 -> disabled with message", (await submit.isDisabled()) && /de 1 a 500/.test(await dialog(p).getByTestId("dl-problem").innerText()));
  await setRange(p, 1, 501);
  t.check("range past the end -> disabled", await submit.isDisabled());
  await setRange(p, 9, 3);
  t.check("from > to -> disabled", (await submit.isDisabled()) && /no puede ser mayor/.test(await dialog(p).getByTestId("dl-problem").innerText()));
  await setRange(p, 3, 7);
  t.check("3 a 7 -> enabled", await submit.isEnabled());

  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), submit.click()]);
  const file = path.join(out, "admin-3-7.pdf");
  await dl.saveAs(file);
  t.check("file name {slug}-p3-7.pdf", dl.suggestedFilename() === `${big.slug}-p3-7.pdf`, dl.suggestedFilename());
  const info = await inspectPdf(file);
  t.check("PDF opens with pdfjs-dist: 5 pages", info.pages === 5, JSON.stringify(info));
  t.check("page sizes and order are those of pages 3..7", info.sizes.every(([i, w, h]) => w === 1400 && h === hOf(i + 2)), JSON.stringify(info.sizes));
  t.check("no text and no annotations on the pages", info.textItems === 0 && info.annots === 0, JSON.stringify(info));
  t.check("starts with %PDF-", fs.readFileSync(file).subarray(0, 8).toString("latin1").startsWith("%PDF-"));
  await p.waitForSelector("[data-testid=dl-done]");
  const row = await lastLog((x) => x.actor === "admin" && x.book_id === big.id && x.from_page === 3 && x.to_page === 7);
  const done = row && (await waitLog(row.id, "completed"));
  t.check("admin download logged: Admin, 3-7, 5 pages, completed", done && done.status === "completed" && done.page_count === 5 && done.device === "Ordenador" && done.book_title === BIG, JSON.stringify(done));
  await c.close();
}

// ================= admin: full 500 pages, heap =================
let fullBytes = 0, peakHeap = 0;
{
  const c = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await cdp.send("Performance.enable");
  await p.goto(BASE + "/admin");
  await p.waitForSelector(`text=${BIG}`);
  await openDialog(p, BIG);
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      const m = (await cdp.send("Performance.getMetrics").catch(() => ({ metrics: [] }))).metrics.find((x) => x.name === "JSHeapUsedSize");
      if (m) peakHeap = Math.max(peakHeap, m.value);
      await sleep(150);
    }
  })();
  const t0 = Date.now();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 900000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
  const file = path.join(out, "admin-full.pdf");
  await dl.saveAs(file);
  stop = true; await sampler;
  fullBytes = fs.statSync(file).size;
  console.log(`  full download: ${(fullBytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s, peak JS heap ${(peakHeap / 1048576).toFixed(1)} MB`);
  t.check("full download file name", dl.suggestedFilename() === `${big.slug}-p1-500.pdf`, dl.suggestedFilename());
  const info = await inspectPdf(file, { sample: 12 });
  t.check("500-page PDF opens in pdfjs-dist with 500 pages", info.pages === 500, JSON.stringify(info.pages));
  t.check("sampled pages have the right sizes, no text", info.sizes.every(([i, w, h]) => w === 1400 && h === hOf(i)) && info.textItems === 0, JSON.stringify(info.sizes.slice(0, 4)));
  t.check("peak JS heap is well below the PDF size (< 1/4)", peakHeap > 0 && peakHeap < fullBytes / 4, `heap ${(peakHeap / 1048576).toFixed(1)} MB vs file ${(fullBytes / 1048576).toFixed(1)} MB`);
  await p.waitForSelector("[data-testid=dl-done]");
  const row = await lastLog((x) => x.actor === "admin" && x.book_id === big.id && x.from_page === 1 && x.to_page === 500);
  t.check("full download logged as completed, 500 pages", row && (await waitLog(row.id, "completed")).status === "completed" && row.page_count === 500);
  await c.close();
}

// ================= admin: Cancelar, and closing the tab =================
{
  const c = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  await p.route("**/api/storage/local*", async (r) => { await sleep(40); await r.continue(); });
  await p.goto(BASE + "/admin");
  await p.waitForSelector(`text=${BIG}`);
  await openDialog(p, BIG);
  let downloads = 0;
  p.on("download", () => downloads++);
  await dialog(p).getByRole("button", { name: "Descargar PDF" }).click();
  await p.waitForFunction(() => /^([1-9]\d*) \/ 500/.test(document.querySelector("[data-testid=dl-progress]")?.textContent ?? ""), null, { timeout: 30000 });
  await dialog(p).getByRole("button", { name: "Cancelar", exact: true }).click();
  await p.waitForSelector("[data-testid=dl-cancelled]");
  const frozen = await dialog(p).getByTestId("dl-progress").innerText();
  await sleep(1200);
  t.check("Cancelar stops cleanly: no download, progress frozen, form usable again", downloads === 0 && (await dialog(p).getByTestId("dl-progress").innerText()) === frozen && (await dialog(p).getByRole("button", { name: "Descargar PDF" }).isEnabled()), frozen);
  t.check("cancelled download logged as Cancelada", !!(await lastLog((x) => x.actor === "admin" && x.status === "cancelled" && x.page_count === 500)));
  await c.close();
}
{
  const c = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  await p.route("**/api/storage/local*", async (r) => { await sleep(60); await r.continue(); });
  await p.goto(BASE + "/admin");
  await p.waitForSelector(`text=${BIG}`);
  await openDialog(p, BIG);
  await setRange(p, 10, 90);
  const before = new Set((await logRows()).map((x) => x.id));
  await dialog(p).getByRole("button", { name: "Descargar PDF" }).click();
  await p.waitForFunction(() => /^([1-9]\d*) \/ 81/.test(document.querySelector("[data-testid=dl-progress]")?.textContent ?? ""), null, { timeout: 30000 });
  const started = (await logRows()).find((x) => !before.has(x.id));
  t.check("a running download is 'En curso' in the log", started && started.status === "started" && started.from_page === 10 && started.to_page === 90, JSON.stringify(started));
  await p.close({ runBeforeUnload: false });
  const closed = started && (await waitLog(started.id, "cancelled", 10000));
  t.check("closing the tab marks it Cancelada", closed && closed.status === "cancelled" && !!closed.finished_at, JSON.stringify(closed));
  await c.close();
}

// ================= reader =================
async function reader(name, can) {
  const username = `dl-${name}-${stamp}`.slice(0, 32);
  const made = (await api("/api/admin/users", "POST", { username, display_name: `Lector ${name}`, books: [small.id, odd.id] })).json;
  await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
  if (can) await api(`/api/admin/users/${made.id}`, "PATCH", { can_download: true });
  return { username, id: made.id };
}
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
async function readerPage(u, { w, h, dark = false, touch = false, slug = small.slug, hash = "#leer" }) {
  const c = await context(browser, { w, h, dark, touch, saved: false, books: [], userAgent: touch ? PHONE_UA : undefined });
  const r = await c.request.post(BASE + "/api/me/login", { data: { username: u.username, password: PW }, headers: { Origin: BASE } });
  if (r.status() !== 200) throw new Error("login " + r.status());
  const p = await c.newPage();
  await p.goto(`${BASE}/b/${slug}${hash}`);
  await p.waitForSelector("header[role=toolbar]", { timeout: 20000 });
  await sleep(2200);
  return { c, p };
}
const can = await reader("can", true);
const cannot = await reader("cannot", false);
{
  const { c, p } = await readerPage(cannot, { w: 1440, h: 900 });
  t.check("no permission: no Descargar PDF in the toolbar", (await p.getByTestId("download-open").count()) === 0 && (await p.getByRole("button", { name: "Descargar PDF" }).count()) === 0);
  await c.close();
}
{
  const { c, p } = await readerPage(can, { w: 1440, h: 900 });
  const btn = p.locator("header[role=toolbar]").getByTestId("download-open");
  t.check("permission: Descargar PDF in the desktop toolbar", (await btn.count()) === 1 && (await btn.isVisible()));
  t.check("button shows its label on wide screens", (await btn.innerText()).includes("Descargar PDF"));
  await btn.click();
  await p.waitForSelector("dialog[open]");
  t.check("dialog: range defaults to the whole book", (await dialog(p).getByRole("radio", { name: /Todo el libro/ }).isChecked()) && (await dialog(p).getByLabel("Hasta la página").inputValue()) === "14");
  await dialog(p).getByRole("button", { name: "Página actual" }).click();
  const a = await dialog(p).getByLabel("Desde la página").inputValue(), b = await dialog(p).getByLabel("Hasta la página").inputValue();
  t.check("Página actual fills the page or spread on screen", a === "1" && b === "1", `${a}-${b}`);
  await setRange(p, 2, 5);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
  const file = path.join(out, "user-2-5.pdf");
  await dl.saveAs(file);
  const info = await inspectPdf(file);
  t.check("reader PDF: 4 pages, right sizes, no text", info.pages === 4 && info.sizes.every(([i, w, h]) => w === 800 && h === 1000 + (i + 1) * 10) && info.textItems === 0, JSON.stringify(info));
  t.check("reader file name", dl.suggestedFilename() === `${small.slug}-p2-5.pdf`, dl.suggestedFilename());
  await p.waitForSelector("[data-testid=dl-done]");
  const row = await lastLog((x) => x.actor === "user" && x.user_id === can.id && x.from_page === 2 && x.to_page === 5);
  const done = row && (await waitLog(row.id, "completed"));
  t.check("reader download logged with user, book, range, count, device", done && done.status === "completed" && done.username === can.username && done.display_name === "Lector can" && done.book_title === small.title && done.page_count === 4 && done.device === "Ordenador", JSON.stringify(done));
  await c.close();
}
{
  const { c, p } = await readerPage(can, { w: 390, h: 844, touch: true });
  t.check("phone: no download button in the bar itself", (await p.locator("#lector-menu").count()) === 0 && (await p.locator("header[role=toolbar] [data-testid=download-open]:visible").count()) === 0);
  await p.getByRole("button", { name: "Más opciones" }).click();
  const item = p.locator("#lector-menu").getByTestId("download-open");
  t.check("phone: Descargar PDF is in the ⋯ menu", (await item.count()) === 1 && (await item.isVisible()) && (await item.innerText()).includes("Descargar PDF"));
  await item.click();
  await p.waitForSelector("dialog[open]");
  await setRange(p, 6, 8);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
  const file = path.join(out, "user-mobile.pdf");
  await dl.saveAs(file);
  const info = await inspectPdf(file);
  t.check("phone PDF: 3 pages, no text", info.pages === 3 && info.textItems === 0, JSON.stringify(info));
  const row = await lastLog((x) => x.user_id === can.id && x.from_page === 6 && x.to_page === 8);
  const done = row && (await waitLog(row.id, "completed"));
  t.check("phone download logged as Móvil", done && done.device === "Móvil", JSON.stringify(done));
  await c.close();
}
{
  const lim = await reader("lim", true);
  const { c, p } = await readerPage(lim, { w: 1440, h: 900 });
  for (let i = 0; i < 5; i++) {
    await p.getByTestId("download-open").click();
    await p.waitForSelector("dialog[open]");
    await setRange(p, 1, 1);
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), dialog(p).getByRole("button", { name: "Descargar PDF" }).click()]);
    await dl.path();
    await p.waitForSelector("[data-testid=dl-done]");
    await dialog(p).getByRole("button", { name: "Cerrar" }).click();
    await sleep(400);
  }
  await p.getByTestId("download-open").click();
  await p.waitForSelector("dialog[open]");
  await setRange(p, 1, 1);
  await dialog(p).getByRole("button", { name: "Descargar PDF" }).click();
  await p.waitForSelector("[data-testid=dl-failed]");
  t.check("6th download in an hour is refused with a clear message", /límite de 5 descargas por hora/.test(await dialog(p).getByTestId("dl-failed").innerText()));
  await c.close();
}

// ================= the log screen =================
{
  for (let i = 0; i < 60; i++) {
    const r = (await api("/api/admin/downloads", "POST", { book_id: small.id, from: 1 + (i % 5), to: 6 + (i % 5) })).json;
    await api(`/api/downloads/${r.id}/finish`, "POST", { status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "cancelled" : "failed" });
  }
  const c = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await c.newPage();
  await p.goto(BASE + "/admin");
  await p.getByRole("tab", { name: "Descargas" }).click();
  await p.waitForSelector("[data-testid=log-table] [role=row][data-status]");
  const rows = () => p.locator("[data-testid=log-table] [role=row][data-status]");
  t.check("log: 50 rows on page 1", (await rows().count()) === 50, String(await rows().count()));
  const total = Number((await p.getByTestId("log-total").innerText()).replace(/\D/g, ""));
  t.check("log: total count shown", total > 60, String(total));
  t.check("log: pager says Página 1 de N", /^Página 1 de \d+$/.test(await p.getByTestId("log-page").innerText()));
  const first = await rows().first().innerText();
  t.check("log: columns present", (await p.locator("[role=columnheader]").allInnerTexts()).join("|") === "Fecha y hora|Usuario|Libro|Páginas|Nº de páginas|Dispositivo|Estado");
  t.check("log: date like '20 oct 2026, 09:53'", /\d{1,2} \p{L}+ \d{4}, \d{2}:\d{2}/u.test(first), first.slice(0, 40));
  t.check("log: chips Completada / Cancelada / Fallida", (await p.getByText("Completada").count()) > 0 && (await p.getByText("Fallida").count()) > 0 && (await p.getByText("Cancelada").count()) > 0);
  t.check("log: admin shows as 'Admin'", first.includes("Admin"));
  await p.getByRole("button", { name: "Siguiente" }).click();
  await sleep(500);
  t.check("log: page 2 has the rest", /^Página 2 de/.test(await p.getByTestId("log-page").innerText()) && (await rows().count()) >= 1);
  await p.getByLabel("Usuario").selectOption({ label: `Lector can (@${can.username})` });
  await sleep(500);
  const canRows = await rows().count();
  t.check("filter by user: only that user's rows", canRows >= 2 && (await rows().allInnerTexts()).every((x) => x.includes(`@${can.username}`)), String(canRows));
  t.check("filter resets to page 1 and shows the count", /^Página 1 de 1$/.test(await p.getByTestId("log-page").innerText()) && Number((await p.getByTestId("log-total").innerText()).replace(/\D/g, "")) === canRows);
  await p.getByLabel("Usuario").selectOption("");
  await p.getByLabel("Libro").selectOption({ label: BIG });
  await sleep(500);
  t.check("filter by book: only that book", (await rows().count()) >= 3 && (await rows().allInnerTexts()).every((x) => x.includes(BIG)));
  t.check("'Todo (1–500)' for a whole-book download", (await p.getByText("Todo (1–500)").count()) >= 1);
  t.check("range shown as 3–7", (await p.locator("[data-col=pages]", { hasText: "3–7" }).count()) >= 1);
  await p.getByLabel("Libro").selectOption("");
  const today = new Date().toISOString().slice(0, 10);
  await p.getByLabel("Desde").fill("2999-01-01");
  await sleep(500);
  t.check("filter by date range (future) -> none", (await p.getByText("No hay descargas").count()) === 1);
  await p.getByLabel("Desde").fill(today);
  await p.getByLabel("Hasta", { exact: true }).fill(today);
  await sleep(500);
  t.check("filter by date range (today) -> rows", (await rows().count()) > 0);
  await p.getByLabel("Desde").fill(""); await p.getByLabel("Hasta", { exact: true }).fill("");
  await sleep(400);
  const [csv] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Exportar CSV" }).click()]);
  const csvFile = path.join(out, "descargas.csv");
  await csv.saveAs(csvFile);
  const raw = fs.readFileSync(csvFile);
  t.check("CSV: UTF-8 BOM and accents", raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf && raw.toString("utf8").includes("Páginas;Nº de páginas") && raw.toString("utf8").includes("500 páginas"));
  t.check("CSV: name descargas-YYYY-MM-DD.csv", /^descargas-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.suggestedFilename()), csv.suggestedFilename());

  await p.getByRole("tab", { name: "Usuarios" }).click();
  const uli = p.locator("li", { hasText: can.username }).first();
  await uli.getByRole("button", { name: "Historial de descargas" }).click();
  await p.waitForSelector("[data-testid=download-history] [role=row][data-status]");
  t.check("user detail shows that user's downloads", (await uli.locator("[data-testid=download-history] [role=row][data-status]").count()) >= 2);
  await p.getByRole("tab", { name: "Libros" }).click();
  const bli = rowOf(p, BIG);
  await bli.getByRole("button", { name: "Historial" }).click();
  await p.waitForSelector("[data-testid=download-history] [role=row][data-status]");
  t.check("book admin page shows that book's downloads", (await bli.locator("[data-testid=download-history] [role=row][data-status]").count()) >= 3);

  await p.getByRole("tab", { name: "Usuarios" }).click();
  const sw = p.locator("li", { hasText: can.username }).first().getByRole("switch", { name: /Puede descargar PDF/ });
  t.check("users: switch is on for the permitted user", await sw.isChecked());
  const sw2 = p.locator("li", { hasText: cannot.username }).first().getByRole("switch", { name: /Puede descargar PDF/ });
  t.check("…and off by default", !(await sw2.isChecked()));
  await sw2.click();
  await sleep(700);
  t.check("switching it on is stored", (await api("/api/admin/users")).json.users.find((x) => x.id === cannot.id).can_download === true);
  await c.close();
}

// ================= deleting a user and a book keeps the log readable =================
{
  await api(`/api/admin/users/${can.id}`, "DELETE", { username: can.username });
  await api(`/api/admin/books/${odd.id}`, "DELETE", { title: odd.title });
  const keep = (await logRows()).find((x) => x.user_id === can.id) ?? (await api(`/api/admin/downloads?user=${can.id}`)).json.rows[0];
  t.check("deleted user's rows stay readable", keep && keep.display_name === "Lector can" && keep.username === can.username);
}
await api(`/api/admin/books/${small.id}`, "DELETE", { title: small.title });
await browser.close();
t.done();
