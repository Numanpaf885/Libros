// Page indicator in Book mode: "4–5 / 500" for a spread, "1 / 500" for a single page. Mock mode only.
import { PW, adminApi, context } from "./lib.mjs";
import { BASE, adminContext, counter, ensureBook, launch, seedBook, sleep } from "./dl-lib.mjs";

const t = counter("indicator");
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();
const stamp = Date.now().toString(36);
const sc = await adminContext(browser, { w: 900, h: 600, touch: false });
const sp = await sc.newPage();
await sp.goto(BASE + "/admin");
const big = await ensureBook(sp, api, { title: "Libro de 500 páginas (prueba de descargas)", pages: 500, w: 1400, hOf: (n) => 1900 + (n % 9) * 10, rich: true });
const odd = await seedBook(sp, { title: `IND impar ${stamp}`, pages: 7 });
await sc.close();

const username = `ind-${stamp}`.slice(0, 32);
const made = (await api("/api/admin/users", "POST", { username, display_name: "Indicador", books: "all" })).json;
await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });

async function open(slug, { w, h, hash = "#p=1", mode = "book" }) {
  const c = await context(browser, { w, h, touch: w < 800, saved: false, books: [] });
  await c.addInitScript((m) => { try { localStorage.setItem("br:mode", m); localStorage.setItem("br:effect", "none"); } catch {} }, mode);
  await c.request.post(BASE + "/api/me/login", { data: { username, password: PW }, headers: { Origin: BASE } });
  const p = await c.newPage();
  await p.goto(`${BASE}/b/${slug}${hash}`);
  await p.waitForSelector("#pagina", { timeout: 20000 });
  await sleep(2600);
  return { c, p };
}
const box = (p) => p.locator("#pagina");
const total = async (p) => (await p.locator("form span.tnum").innerText()).trim();
const type = async (p, v) => { await box(p).click(); await box(p).fill(v); await p.keyboard.press("Enter"); await sleep(900); };

{
  const { c, p } = await open(big.slug, { w: 1440, h: 900 });
  t.check("cover alone: '1 / 500'", (await box(p).inputValue()) === "1" && (await total(p)) === "/ 500", await box(p).inputValue());
  await type(p, "4");
  t.check("typing 4 lands on the spread containing 4 -> '4–5'", (await box(p).inputValue()) === "4–5", await box(p).inputValue());
  t.check("aria-label 'Páginas 4 y 5 de 500'", (await box(p).getAttribute("aria-label")) === "Páginas 4 y 5 de 500");
  await type(p, "5");
  t.check("typing 5 shows the same spread '4–5'", (await box(p).inputValue()) === "4–5", await box(p).inputValue());
  await p.keyboard.press("ArrowRight"); await sleep(900);
  t.check("turning moves to '6–7'", (await box(p).inputValue()) === "6–7", await box(p).inputValue());
  await type(p, "500");
  t.check("even last page is alone: '500 / 500', no range label", (await box(p).inputValue()) === "500" && !(await box(p).getAttribute("aria-label")), await box(p).inputValue());
  await type(p, "1");
  t.check("typing 1 -> cover '1'", (await box(p).inputValue()) === "1");
  await c.close();
}
{
  const { c, p } = await open(odd.slug, { w: 1440, h: 900, hash: "#p=6" });
  t.check("odd last page of a 7-page book: spread '6–7 / 7'", (await box(p).inputValue()) === "6–7" && (await total(p)) === "/ 7", await box(p).inputValue());
  await c.close();
}
{
  const { c, p } = await open(big.slug, { w: 390, h: 844 });
  t.check("phone: single page '1 / 500'", (await box(p).inputValue()) === "1" && !(await box(p).getAttribute("aria-label")));
  await type(p, "4");
  t.check("phone: typing 4 -> '4'", (await box(p).inputValue()) === "4", await box(p).inputValue());
  await c.close();
}
{
  const { c, p } = await open(big.slug, { w: 1440, h: 900, mode: "pdf" });
  t.check("PDF mode is unchanged: plain number", (await box(p).inputValue()) === "1" && !(await box(p).getAttribute("aria-label")));
  await type(p, "4");
  t.check("PDF mode: typing 4 shows '4'", (await box(p).inputValue()) === "4", await box(p).inputValue());
  await c.close();
}
{
  const { c, p } = await open(big.slug, { w: 800, h: 1100 });
  t.check("portrait tablet: single page", /^\d+$/.test(await box(p).inputValue()));
  await c.close();
}
await api(`/api/admin/books/${odd.id}`, "DELETE", { title: odd.title });
await api(`/api/admin/users/${made.id}`, "DELETE", { username });
await browser.close();
t.done();
