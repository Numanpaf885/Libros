// The site must never hang because of Google Sheets. Runs the REAL Google adapter (lib/db/sheets.ts) against the fake
// Sheets API (e2e/fake-sheets.mjs), which this test starts itself on FAKE_SHEETS_PORT (3999), with every tab's columns
// shuffled and an unknown column added. Start the dev server pointed at it first:
//   FAKE_SHEETS_URL=http://localhost:3999 DATA_BACKEND=mock npx next dev -p 3100
//   node e2e/resilience.mjs
// Scenarios: tabs missing (then «Actualizar base de datos»), Google answering in 15 s, Google answering 429, recovery,
// /api/health. Between scenarios the server forgets its caches (POST /api/test/reset, test mode only), like a new
// Vercel instance. Writes to .data/mock-sheet.json like the mock does.
import { BASE, PW, adminApi, adminContext, context, counter, launch, sleep } from "./lib.mjs";
import { createFakeSheets, UNKNOWN_COLUMN } from "./fake-sheets.mjs";

const t = counter("resilience");
const FAKE = `http://localhost:${Number(process.env.FAKE_SHEETS_PORT) || 3999}`;
const fake = createFakeSheets();
await fake.listen(Number(process.env.FAKE_SHEETS_PORT) || 3999);
let troubleAt = 0; // when Google was last made slow or refusing
const ctl = (b) => { if (b.delayMs || b.fail429 || b.readQuotaPerMin) troubleAt = Date.now(); return fetch(`${FAKE}/__control`, { method: "POST", body: JSON.stringify(b) }).then((r) => r.json()); };
const stats = () => fetch(`${FAKE}/__stats`).then((r) => r.json());
const dump = () => fetch(`${FAKE}/__dump`).then((r) => r.json());
const reset = (scope = "") => fetch(`${BASE}/api/test/reset${scope ? `?scope=${scope}` : ""}`, { method: "POST" });
/** Google fine again, and a fresh server: first let the calls started during the trouble end (they give up at 8 s). */
const quiet = async () => {
  await ctl({ delayMs: 0, fail429: 0, readQuotaPerMin: 0, resetQuota: true });
  if (troubleAt) await sleep(Math.max(0, troubleAt + 9_000 - Date.now()));
  await reset();
};
const stamp = Date.now().toString(36);

await ctl({ reseed: { missingTabs: "messages,settings", shuffle: true } });
if ((await reset()).status !== 200) {
  console.log("Start the dev server with FAKE_SHEETS_URL=" + FAKE + " DATA_BACKEND=mock (see the top of this file).");
  await fake.close();
  process.exit(1);
}
const api = adminApi();
t.check("admin signs in through the fake Google API", (await api("/api/auth/login", "POST", { username: "admin", password: "admin123" })).status === 200);
const h0 = (await api("/api/health")).json;
t.check("the server uses the real Google adapter against the fake API", h0?.backend === "fake-google", h0?.backend);
const books = (await api("/api/admin/books")).json?.books?.filter((b) => b.status === "published") ?? [];
const book = books.find((b) => b.slug === "libro-semilla-a") ?? books[0];
t.check("books readable with shuffled columns and an unknown column", !!book && books.length > 1 && book.page_count > 0, books.length);
// a reader account with every book (created through the fake)
const username = `res-${stamp}`.slice(0, 32);
const made = (await api("/api/admin/users", "POST", { username, display_name: "Resiliencia", books: "all" })).json;
const act = await fetch(`${BASE}/api/me/activate`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made?.code, password: PW }) });
t.check("a reader account can be created and activated", act.status === 200, act.status);

const browser = await launch();
async function reader(w = 1440, h = 900) {
  const c = await context(browser, { w, h, touch: false, saved: false });
  const r = await c.request.post(`${BASE}/api/me/login`, { data: { username, password: PW }, headers: { Origin: BASE } });
  if (r.status() !== 200) throw new Error("reader login " + r.status());
  return c;
}
/** ms until `ready` resolves after starting the navigation (or Infinity). */
async function timed(p, url, ready, max = 30_000) {
  const t0 = Date.now();
  await p.goto(BASE + url, { waitUntil: "commit", timeout: max }).catch(() => {});
  const ok = await ready(p, max).then(() => true, () => false);
  return ok ? Date.now() - t0 : Infinity;
}
const see = (sel) => (p, max) => p.waitForSelector(sel, { timeout: max, state: "visible" });
const retryBtn = (p, max) => p.getByRole("button", { name: "Reintentar" }).first().waitFor({ timeout: max });
const PAGES = [
  ["/", "home", see("#catalogo, #destacado")],
  [`/b/${book.slug}`, "book page", see("h1")],
  ["/entrar", "/entrar", see("#username, #catalogo, #destacado")], // signed in, it sends the reader home
  ["/contacto", "/contacto", see("h1")],
  ["/privacidad", "/privacidad", see("[data-testid=legal-page]")],
  ["/cookies", "/cookies", see("[data-testid=legal-page]")],
  ["/aviso-legal", "/aviso-legal", see("[data-testid=legal-page]")],
];

// warm up: compile every page once (dev server), then start cold
{
  const c = await reader(); const p = await c.newPage();
  for (const [u] of PAGES) await p.goto(BASE + u).catch(() => {});
  await p.goto(`${BASE}/b/${book.slug}#leer`).catch(() => {}); await sleep(3000);
  await c.close();
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false }); const ap = await a.newPage();
  await ap.goto(BASE + "/admin"); await sleep(2000); await a.close();
  // and the error page (compiled on first use in dev: it must not count in the timings below)
  await ctl({ fail429: 100_000 }); await reset();
  const e = await context(browser, { w: 1440, h: 900, touch: false }); const ep = await e.newPage();
  await ep.goto(BASE + "/"); await retryBtn(ep, 20_000).catch(() => {}); await e.close();
  await quiet();
}

// ================= 1. messages and settings tabs missing =================
await reset(); await fetch(`${FAKE}/__stats/reset`, { method: "POST" });
{
  const c = await reader(); const p = await c.newPage();
  for (const [u, name, ready] of PAGES) {
    const ms = await timed(p, u, ready, 10_000);
    t.check(`tabs missing: ${name} loads within 3 s (${ms} ms)`, ms <= 3000);
  }
  // the page image itself, from storage (the reader's opening animation is not part of loading)
  const ms = await timed(p, `/b/${book.slug}#leer`, (pg, max) => pg.waitForResponse((r) => r.url().includes("/api/storage/local") && /\.webp/.test(r.url()) && r.status() === 200, { timeout: max }));
  t.check(`tabs missing: the reader gets a page image from storage within 3 s (${ms} ms)`, ms <= 3000);
  t.check("tabs missing: the reader shows it", !!(await p.waitForSelector(".page-face[data-ready='1'], [data-page] canvas.opacity-100", { timeout: 8000 }).catch(() => null)));
  await c.close();
  const s = await stats();
  t.check("tabs missing: no request ever names a missing tab (no 400)", !s.status["400"], JSON.stringify(s.status));
  t.check(`tabs missing: cold start reads the sheet in a few requests (${s.reads})`, s.reads <= 8, s.log.join("\n"));
}
{
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false }); const p = await a.newPage();
  const ms = await timed(p, "/admin", see("[role=tab]"), 10_000);
  t.check(`tabs missing: /admin loads within 3 s (${ms} ms)`, ms <= 3000);
  t.check("tabs missing: the admin says «Actualiza la base de datos en Mantenimiento»", (await p.getByTestId("outdated-banner").innerText({ timeout: 5000 }).catch(() => "")).includes("Actualiza la base de datos en Mantenimiento"));
  await p.getByRole("tab", { name: /Mensajes/ }).click();
  t.check("tabs missing: Mensajes says so too", (await p.getByTestId("messages-missing").innerText({ timeout: 5000 }).catch(() => "")) === "Actualiza la base de datos en Mantenimiento.");
  // public health: {ok} only; admin: the details
  const pub = await (await fetch(`${BASE}/api/health`)).json();
  t.check("/api/health public: only {ok}", JSON.stringify(Object.keys(pub)) === '["ok"]' && pub.ok === true, JSON.stringify(pub));
  const det = (await api("/api/health?fresh=1")).json;
  t.check("/api/health admin: Sheets reachable, tabs found and missing, timings", det.sheets.ok && det.sheets.ms >= 0 && det.sheets.tabs_missing.join() === "messages,settings" && det.storage.ok && det.storage.ms >= 0, JSON.stringify(det.sheets));
  await p.getByRole("tab", { name: "Mantenimiento" }).click();
  await p.waitForSelector("[data-testid=status-sheets]");
  t.check("Mantenimiento → Estado del sistema: connected, the missing tabs named", (await p.getByTestId("status-sheets").getAttribute("data-ok")) === "1" && (await p.getByTestId("status-missing-tabs").innerText()).includes("messages"));
  // «Actualizar base de datos»: the tabs appear and everything works, no restart
  await p.getByRole("button", { name: "Actualizar base de datos" }).click();
  await p.waitForSelector("[data-testid=maintenance-result]", { timeout: 20_000 });
  const tabsNow = Object.keys(await dump());
  t.check("Actualizar base de datos creates messages and settings in the sheet", tabsNow.includes("messages") && tabsNow.includes("settings"));
  await p.getByRole("tab", { name: /Mensajes/ }).click();
  t.check("…Mensajes works right after", !!(await p.waitForSelector("[data-testid=messages-panel]", { timeout: 8000 }).catch(() => null)));
  await p.getByRole("tab", { name: "Ajustes legales" }).click();
  await p.waitForSelector("#legal-owner", { timeout: 8000 });
  await p.fill("#legal-owner", "Titular de prueba"); await p.fill("#legal-email", "titular@example.com");
  await p.getByRole("button", { name: "Guardar" }).click(); await sleep(1200);
  const rows = (await dump()).settings;
  t.check("…Ajustes legales saves into the new tab", rows.some((r) => r.includes("Titular de prueba")), JSON.stringify(rows));
  t.check("…no banner any more", (await p.getByTestId("outdated-banner").count()) === 0 || !(await p.getByTestId("outdated-banner").isVisible()));
  await a.close();
  const v = await context(browser, { w: 390, h: 844 }); const vp = await v.newPage();
  await vp.goto(BASE + "/contacto");
  t.check("…/contacto shows the form right after", !!(await vp.waitForSelector("[data-testid=contact-form]", { timeout: 8000 }).catch(() => null)));
  await vp.goto(BASE + "/aviso-legal");
  t.check("…the legal pages show the details", (await vp.getByTestId("legal-owner").innerText()).includes("Titular de prueba"));
  await v.close();
  // columns by name: the unknown column of every tab is kept by every write
  const d = await dump();
  const users = d.users; const col = users[0].indexOf(UNKNOWN_COLUMN);
  const me = users.find((r) => r.includes(username));
  t.check("shuffled columns: the new user's row was written under the right headers", !!me && me[users[0].indexOf("username")] === username && me[users[0].indexOf("status")] === "active" && me[users[0].indexOf("display_name")] === "Resiliencia");
  t.check("shuffled columns: rows updated by the app keep the unknown column", users.slice(1).filter((r) => r[col]?.startsWith("keep-")).length >= users.length - 3, `${users.slice(1).filter((r) => r[col]?.startsWith("keep-")).length} of ${users.length - 1}`);
}

// ================= 2. Google answers in 15 s =================
const SLOW = [
  ["/", "home"],
  [`/b/${book.slug}`, "book page"],
  ["/contacto", "/contacto"],
];
for (const [u, name] of SLOW) {
  await quiet();
  const c = await reader(); const p = await c.newPage(); // signed in while Google is fine
  await reset(); await ctl({ delayMs: 15_000 }); // then a cold server and a slow Google
  const ms = await timed(p, u, retryBtn, 20_000);
  t.check(`Google slow (15 s): ${name} shows «Reintentar» within 9 s (${ms} ms)`, ms <= 9000);
  t.check(`Google slow: ${name} explains it in Spanish`, /no responde|No se ha podido|no podemos/i.test(await p.locator("main").innerText().catch(() => "")));
  await c.close();
}
{
  await quiet();
  const a = await adminContext(browser, { w: 1440, h: 900, touch: false }); const p = await a.newPage();
  await reset(); await ctl({ delayMs: 15_000 });
  const ms = await timed(p, "/admin", retryBtn, 20_000);
  t.check(`Google slow: /admin shows «Reintentar» within 9 s (${ms} ms)`, ms <= 9000);
  await a.close();
  const c = await context(browser, { w: 1440, h: 900 }); const lp = await c.newPage();
  for (const u of ["/privacidad", "/cookies", "/aviso-legal", "/entrar"]) {
    const t1 = await timed(lp, u, see("h1"), 10_000);
    t.check(`Google slow: ${u} still renders at once, without waiting for the settings (${t1} ms)`, t1 <= 3000);
  }
  await c.close();
  const pub = await fetch(`${BASE}/api/health`);
  t.check("Google slow: public /api/health says {ok:false} (503) quickly", pub.status === 503 && JSON.stringify(await pub.json()) === '{"ok":false}');
}
// with the book list cached, the catalogue still renders when the account part cannot be read
{
  await quiet();
  const c = await reader(); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector("#catalogo, #destacado");
  await reset("users"); await ctl({ delayMs: 15_000 });
  const ms = await timed(p, "/", see("[data-testid=partial-notice]"), 20_000);
  t.check(`Google slow, books cached: the catalogue renders with a notice and «Reintentar» (${ms} ms)`, ms <= 9000 && (await p.locator("#catalogo, #destacado").count()) > 0 && (await p.getByTestId("partial-notice").getByRole("button", { name: "Reintentar" }).count()) === 1,
    (await p.locator("body").innerText().catch(() => "")).slice(0, 200) + " | " + (await stats()).log.slice(-6).join(" | "));
  await c.close();
}

// ================= 3. Google answers 429 =================
{
  await quiet();
  const c = await reader(); const p = await c.newPage();
  await reset(); await fetch(`${FAKE}/__stats/reset`, { method: "POST" });
  await ctl({ fail429: 100_000 });
  const ms = await timed(p, "/", retryBtn, 20_000);
  t.check(`429: home shows «Reintentar» within 9 s (${ms} ms)`, ms <= 9000);
  const s = await stats();
  const times = s.log.filter((l) => l.includes(" 429 ")).map((l) => Number(l.split(" ")[0]));
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  // one call: at most 5 attempts with growing waits (0.4, 0.8, 1.6, 3.2 s); a page may make a second call before the
  // pause starts (dev renders a failing page twice), never more
  t.check(`429: retried with growing waits, then gave up (${times.length} requests, gaps ${gaps.join("/")} ms)`, times.length >= 3 && times.length <= 10 && gaps[1] >= gaps[0] * 1.3 && gaps[0] >= 350);
  // the pause: further pages fail at once instead of sending more requests
  const before = (await stats()).total;
  await p.goto(`${BASE}/b/${book.slug}`); await retryBtn(p, 10_000).catch(() => {});
  t.check("429: during the pause no more requests are sent to Google", (await stats()).total === before, `${before} -> ${(await stats()).total}`);
  // recovery: Google is fine again; after the pause, «Reintentar» brings the page back
  await ctl({ fail429: 0 });
  const det = (await api("/api/health")).json;
  await sleep(Math.min(25_000, (det?.sheets?.paused?.retry_in_s ?? 20) * 1000 + 500));
  await p.goto(BASE + "/"); await retryBtn(p, 10_000).catch(() => {});
  if (await p.getByRole("button", { name: "Reintentar" }).count()) await p.getByRole("button", { name: "Reintentar" }).first().click();
  t.check("recovery: once Google answers again, the page comes back", !!(await p.waitForSelector("#catalogo, #destacado", { timeout: 15_000 }).catch(() => null)));
  await c.close();
}

// ================= 4. a quota like Google's (60 reads per minute) does not take the site down =================
{
  await quiet(); await fetch(`${FAKE}/__stats/reset`, { method: "POST" }); await ctl({ readQuotaPerMin: 60 });
  const c = await reader(); const p = await c.newPage();
  let slowest = 0;
  for (let i = 0; i < 12; i++) for (const [u, , ready] of PAGES.slice(0, 4)) slowest = Math.max(slowest, await timed(p, u, ready, 15_000));
  t.check(`quota 60/min: 48 page views, none slower than 3 s (slowest ${slowest} ms)`, slowest <= 3000);
  const s = await stats();
  const kinds = {}; for (const l of s.log) { const k = l.split(" ").slice(2, 5).join(" ").slice(0, 70); kinds[k] = (kinds[k] ?? 0) + 1; }
  t.check(`quota 60/min: the cache keeps reads far below the quota (${s.status["429"] ?? 0} refused, ${s.reads} reads)`, !s.status["429"], JSON.stringify(kinds));
  await c.close();
}

await quiet();
await browser.close();
await fake.close();
t.done();
