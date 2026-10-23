// "Mantenimiento → Actualizar base de datos" (mock mode). Needs a dev server whose sheet lacks one tab and two columns:
//   MOCK_MISSING_TABS=bookmarks MOCK_MISSING_COLUMNS=text_pages,allow_copy DATA_BACKEND=mock npx next dev -p 3100
// then  node e2e/maintenance.mjs   (SCREENSHOTS=1 also saves the section in light and dark at 390 and 1440 px).
// The mock keeps the simulated header row in memory: restart the server to run this again.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE, PW, SHOTS, adminApi, adminContext, counter, launch, sleep, warm } from "./lib.mjs";
import { expectedColumns, googleSheetAdmin, TAB_NAMES, updateSheet } from "../lib/sheet-schema.ts";

const t = counter("maintenance");
const shots = process.env.SCREENSHOTS === "1";

// ---- 1. the Google adapter used by `npm run setup-sheet` and the route, against a fake Sheets API (no network) ----
{
  const sheet = Object.fromEntries(TAB_NAMES.map((tab) => [tab, [expectedColumns(tab), ["data", "row"]]]));
  delete sheet.bookmarks;
  sheet.books[0] = sheet.books[0].filter((c) => c !== "text_pages" && c !== "allow_copy");
  const before = JSON.stringify(sheet);
  const calls = [];
  const fake = {
    spreadsheets: {
      get: async () => ({ data: { sheets: Object.keys(sheet).map((title) => ({ properties: { title } })) } }),
      batchUpdate: async ({ requestBody }) => { calls.push(["batchUpdate", requestBody]); for (const r of requestBody.requests) sheet[r.addSheet.properties.title] = [[]]; return {}; },
      values: {
        batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map((r) => ({ values: [sheet[r.split("!")[0]][0]] })) } }),
        batchUpdate: async ({ requestBody }) => {
          calls.push(["values", requestBody]);
          for (const d of requestBody.data) {
            const [, tab, a, b] = /^(\w+)!([A-Z]+)1:([A-Z]+)1$/.exec(d.range);
            const n = (s) => [...s].reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0);
            if (n(b) - n(a) + 1 !== d.values[0].length) throw new Error("range width");
            d.values[0].forEach((v, i) => { sheet[tab][0][n(a) - 1 + i] = v; });
          }
          return {};
        },
      },
    },
  };
  const r1 = await updateSheet(googleSheetAdmin(fake, "fake-id"));
  t.check("adapter: exactly the missing tab and two columns", JSON.stringify(r1.changes) === JSON.stringify([{ kind: "tab", tab: "bookmarks" }, { kind: "column", tab: "books", column: "text_pages" }, { kind: "column", tab: "books", column: "allow_copy" }]), JSON.stringify(r1.changes));
  const ranges = calls.filter((c) => c[0] === "values").flatMap((c) => c[1].data.map((d) => d.range));
  t.check("adapter: writes only row 1, after the last header", JSON.stringify(ranges) === JSON.stringify(["books!Q1:R1", "bookmarks!A1:F1"]), JSON.stringify(ranges));
  t.check("adapter: RAW values", calls.filter((c) => c[0] === "values").every((c) => c[1].valueInputOption === "RAW"));
  t.check("adapter: one write per kind (2 writes)", calls.length === 2, calls.length);
  const books = sheet.books[0];
  t.check("adapter: books header ends ...text_status, text_pages, allow_copy", books.slice(-3).join() === "text_status,text_pages,allow_copy");
  const old = JSON.parse(before);
  t.check("adapter: data rows untouched", Object.keys(old).every((tab) => JSON.stringify(sheet[tab].slice(1)) === JSON.stringify(old[tab].slice(1))));
  const r2 = await updateSheet(googleSheetAdmin(fake, "fake-id"));
  t.check("adapter: second run changes nothing and writes nothing", r2.changes.length === 0 && calls.length === 2);
}

// ---- 2. the route and the admin section, on the mock sheet ----
const FILE = path.join(process.cwd(), ".data", "mock-sheet.json");
const hash = () => crypto.createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
const ROUTE = "/api/admin/maintenance";
const req = async (p, { method = "GET", cookie = "", origin = BASE, body } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ?? (method === "GET" ? undefined : "{}") });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
};
const login = async (p, data) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(data) });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};
const admin = await login("/api/auth/login", { username: "admin", password: "admin123" });
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });

const stamp = Date.now().toString(36);
const username = `mnt-${stamp}`.slice(0, 32);
const made = (await api("/api/admin/users", "POST", { username, display_name: "Mantenimiento", books: "all" })).json;
await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
const reader = await login("/api/me/login", { username, password: PW });
const pub = (await api("/api/admin/books")).json.books.find((b) => b.status === "published");
if (!pub) throw new Error("need a published book in the mock data");
const bookmarksAvailable = async () => (await req(`/api/bookmarks?slug=${encodeURIComponent(pub.slug)}`, { cookie: reader })).json?.available;

const status0 = (await req(ROUTE, { cookie: admin })).json?.tabs ?? [];
const by = (list) => Object.fromEntries(list.map((x) => [x.tab, x]));
const s0 = by(status0);
t.check("status lists every tab of the schema", status0.map((x) => x.tab).join() === TAB_NAMES.join());
t.check("status: bookmarks tab missing", s0.bookmarks?.exists === false && s0.bookmarks.missing.length === 6);
t.check("status: books lacks exactly text_pages, allow_copy", JSON.stringify(s0.books?.missing) === JSON.stringify(["text_pages", "allow_copy"]), JSON.stringify(s0.books));
t.check("status: every other tab complete", status0.filter((x) => x.tab !== "bookmarks" && x.tab !== "books").every((x) => x.exists && !x.missing.length && !x.misplaced.length));
t.check("status: only tab and column names (no ids, keys or rows)", JSON.stringify(status0).length < 6000 && !/books\/[a-f0-9]{32}|\$2[aby]\$|@/.test(JSON.stringify(status0)));
t.check("before: the app has no bookmarks tab (reader bookmarks stay on the device)", (await bookmarksAvailable()) === false);

// not an admin: 401 / 403, and nothing changes
t.check("signed out GET -> 401", (await req(ROUTE)).status === 401);
t.check("signed out POST -> 401", (await req(ROUTE, { method: "POST" })).status === 401);
t.check("reader account GET -> 401", (await req(ROUTE, { cookie: reader })).status === 401);
t.check("reader account POST -> 401", (await req(ROUTE, { method: "POST", cookie: reader })).status === 401);
t.check("forged admin cookie POST -> 401", (await req(ROUTE, { method: "POST", cookie: "br_admin=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4ifQ.bad" })).status === 401);
t.check("admin POST from another site -> 403", (await req(ROUTE, { method: "POST", cookie: admin, origin: "https://evil.example" })).status === 403);
t.check("admin POST without Origin -> 403", (await req(ROUTE, { method: "POST", cookie: admin, origin: "" })).status === 403);
t.check("rejected requests changed nothing", JSON.stringify((await req(ROUTE, { cookie: admin })).json?.tabs) === JSON.stringify(status0));

const h0 = hash();
await warm(["/admin"], admin);
const browser = await launch();
const ctx = await adminContext(browser, { w: 1440, h: 900, touch: false });
const p = await ctx.newPage();
let navs = 0;
p.on("framenavigated", (f) => { if (f === p.mainFrame()) navs++; });
await p.goto(BASE + "/admin");
// the dev server may reload a freshly compiled page a few times: wait until it has been still for 2 s
for (let i = 0, seen = -1; i < 40 && seen !== navs; i++) { seen = navs; await sleep(2000); }
await p.getByRole("tab", { name: "Mantenimiento" }).click();
await p.waitForSelector("[data-testid=maintenance-status]");
await sleep(400);
const rowChip = (tab) => p.locator(`[data-testid=maintenance-status] [data-tab=${tab}] .chip`).innerText();
t.check("UI: 'Hay 3 cambios pendientes'", (await p.locator("[data-testid=maintenance-pending]").innerText()) === "Hay 3 cambios pendientes");
t.check("UI: bookmarks row says 'Falta la pestaña'", (await rowChip("bookmarks")) === "Falta la pestaña");
t.check("UI: books row says 'Faltan 2 columnas'", (await rowChip("books")) === "Faltan 2 columnas");
t.check("UI: books row lists the two missing columns", (await p.locator("[data-tab=books] [data-col=missing]").innerText()).includes("allow_copy"));
t.check("UI: users row says 'Al día'", (await rowChip("users")) === "Al día");

const VARIANTS = [[390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]];
const look = async (w, theme) => {
  await p.setViewportSize({ width: w, height: 900 });
  await p.evaluate((th) => { document.documentElement.dataset.theme = th; document.documentElement.style.colorScheme = th; }, theme);
  await sleep(250);
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  t.check(`${w}px ${theme}: no horizontal overflow (${m.sw} <= ${m.iw})`, m.sw <= m.iw);
};
const shoot = async (name) => { if (shots) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name), fullPage: true }); } };
for (const [w, theme] of VARIANTS) { await look(w, theme); await shoot(`maintenance-before-${w}-${theme}.png`); }
await look(320, "light");

// first run: exactly the missing tab and the two columns
await look(1440, "light");
await p.getByRole("button", { name: "Actualizar base de datos" }).click();
await p.waitForSelector("[data-testid=maintenance-result]");
const items = await p.locator("[data-testid=maintenance-result] li").allInnerTexts();
t.check("UI run 1: 'Pestaña bookmarks creada', 'Columna text_pages añadida', 'Columna allow_copy añadida'",
  JSON.stringify(items.map((s) => s.replace(/\s+/g, " ").trim())) === JSON.stringify(["Pestaña bookmarks creada", "Columna text_pages añadida en books", "Columna allow_copy añadida en books"]), JSON.stringify(items));
t.check("UI run 1: every tab 'Al día' afterwards", (await p.locator("[data-testid=maintenance-status] .chip").allInnerTexts()).every((x) => x === "Al día"));
for (const [w, theme] of VARIANTS) { await look(w, theme); await shoot(`maintenance-result-${w}-${theme}.png`); }

// second run: nothing left to do
await look(1440, "light");
await p.getByRole("button", { name: "Actualizar base de datos" }).click();
await p.waitForFunction(() => document.querySelector("[data-testid=maintenance-result]")?.textContent?.includes("Todo al día"));
t.check("UI run 2: 'Todo al día'", (await p.locator("[data-testid=maintenance-result]").innerText()).includes("Todo al día") && (await p.locator("[data-testid=maintenance-result] li").count()) === 0);
for (const [w, theme] of [[390, "dark"], [1440, "light"]]) { await look(w, theme); await shoot(`maintenance-uptodate-${w}-${theme}.png`); }

const status1 = (await req(ROUTE, { cookie: admin })).json?.tabs ?? [];
t.check("after: every tab exists with every column, in order", status1.every((x) => x.exists && !x.missing.length && !x.misplaced.length && x.columns.join() === expectedColumns(x.tab).join()));
const third = await req(ROUTE, { method: "POST", cookie: admin });
t.check("API run 3: 200 and no changes (idempotent)", third.status === 200 && third.json?.changes?.length === 0, JSON.stringify(third.json?.changes));
const fourth = await req(ROUTE, { method: "POST", cookie: admin });
t.check("API run 4 within a minute: 429 (3 per minute)", fourth.status === 429 && fourth.headers.get("retry-after") === "60", fourth.status);
t.check("existing rows byte-for-byte unchanged (.data/mock-sheet.json)", hash() === h0);
t.check("after: the app uses the new tab at once (reader bookmarks available)", (await bookmarksAvailable()) === true);
t.check("after: admin book list still works", (await api("/api/admin/books")).json?.books?.some((b) => b.id === pub.id));

await browser.close();
if (shots) console.log(`screenshots in ${SHOTS}`);
t.done();
