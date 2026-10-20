// A sheet that has not been through `npm run setup-sheet` (no users.can_download, or no `downloads` tab):
// everything else works, the download UI and the log stay hidden. Start the dev server with the matching flag:
//   MOCK_MISSING_COLUMNS=can_download DATA_BACKEND=mock npx next dev -p 3100     (or MOCK_MISSING_TABS=downloads)
import { PW, adminApi } from "./lib.mjs";
import { BASE, adminContext, counter, launch, sleep } from "./dl-lib.mjs";
import { context } from "./lib.mjs";

const t = counter(`downloads-missing (${process.env.WHICH ?? "?"})`);
const api = adminApi();
t.check("admin sign-in works", (await api("/api/auth/login", "POST", { username: "admin", password: "admin123" })).status === 200);
const stamp = Date.now().toString(36);
const books = (await api("/api/admin/books")).json;
t.check("books list works", Array.isArray(books.books));
const pub = books.books.find((b) => b.status === "published");
const username = `miss-${stamp}`.slice(0, 32);
const made = (await api("/api/admin/users", "POST", { username, display_name: "Sin columna", books: "all" }));
t.check("creating a user works", made.status === 201, made.status);
const act = await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.json.code, password: PW }) });
t.check("activating works", act.status === 200, act.status);
const login = await fetch(BASE + "/api/me/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, password: PW }) });
t.check("reader login works", login.status === 200, login.status);
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const jar = (p, m = "GET", b) => fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", cookie, Origin: BASE }, body: b ? JSON.stringify(b) : undefined });
t.check("/api/me works", (await (await jar("/api/me")).json()).user?.username === username);
const meta = await jar(`/api/books/${pub.slug}/meta`);
const mj = await meta.json();
t.check("book meta works and says can_download=false", meta.status === 200 && mj.can_download === false, JSON.stringify(mj));
t.check("a progress/bookmark request still works", (await jar("/api/me/books")).status === 200);

const log = await api("/api/admin/downloads");
t.check("admin log says available:false", log.status === 200 && log.json.available === false, JSON.stringify(log.json));
const users = (await api("/api/admin/users")).json;
t.check("admin users: downloads_available=false", users.downloads_available === false);
const patch = await api(`/api/admin/users/${made.json.id}`, "PATCH", { can_download: true });
t.check("switching can_download is refused (409), nothing stored", patch.status === 409, patch.status);
t.check("other user edits still work (disable/enable)", (await api(`/api/admin/users/${made.json.id}`, "PATCH", { disabled: true })).status === 200 && (await api(`/api/admin/users/${made.json.id}`, "PATCH", { disabled: false })).status === 200);
t.check("start download -> 404", (await jar(`/api/books/${pub.slug}/download`, "POST", { from: 1, to: 1 })).status === 404);
t.check("pages route -> 404", (await jar(`/api/books/${pub.slug}/download/pages`, "POST", { token: "x".repeat(30), pages: [1] })).status === 404);
t.check("admin export -> 404", (await api("/api/admin/downloads/export")).status === 404);
t.check("admin start is a harmless no-op", (await api("/api/admin/downloads", "POST", { book_id: pub.id, from: 1, to: 1 })).json?.id === null);
const csv = await api("/api/admin/books/" + pub.id + "/page-urls", "POST", { pages: [1] });
t.check("admin page-urls still works (it needs neither tab nor column)", csv.status === 200);

const browser = await launch();
{
  const c = await adminContext(browser, { w: 1280, h: 900, touch: false });
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE + "/admin");
  await p.waitForSelector("[role=tab]");
  await sleep(1500);
  t.check("admin: no 'Descargas' tab", (await p.getByRole("tab", { name: "Descargas" }).count()) === 0);
  t.check("admin: no 'Descargar' or 'Historial' buttons", (await p.getByRole("button", { name: "Descargar", exact: true }).count()) === 0 && (await p.getByRole("button", { name: "Historial", exact: true }).count()) === 0);
  await p.getByRole("tab", { name: "Usuarios" }).click();
  await sleep(1200);
  t.check("admin users: no 'Puede descargar PDF' switch, no history button", (await p.getByRole("switch").count()) === 0 && (await p.getByRole("button", { name: "Historial de descargas" }).count()) === 0);
  t.check("no page errors", errors.length === 0, errors.join("|"));
  await c.close();
}
{
  const c = await context(browser, { w: 1440, h: 900, touch: false, saved: false, books: [] });
  await c.request.post(BASE + "/api/me/login", { data: { username, password: PW }, headers: { Origin: BASE } });
  const p = await c.newPage();
  await p.goto(`${BASE}/b/${pub.slug}#leer`);
  await p.waitForSelector("header[role=toolbar]", { timeout: 20000 });
  await sleep(2200);
  t.check("reader opens, no download button", (await p.getByTestId("download-open").count()) === 0);
  await c.close();
}
await api(`/api/admin/users/${made.json.id}`, "DELETE", { username });
await browser.close();
t.done();
