// Download permission, tokens, limits and the log: API level (mock mode).
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/downloads-api.mjs
import { BASE, PW, adminApi, counter, sleep } from "./lib.mjs";
import { adminContext, launch, seedBook } from "./dl-lib.mjs";

const t = counter("downloads-api");
const admin = adminApi();
await admin("/api/auth/login", "POST", { username: "admin", password: "admin123" });

// ---- two small books, made in a browser so the pages are real WebP files ----
const browser = await launch();
const ctx = await adminContext(browser, { w: 1000, h: 700, touch: false });
const pg = await ctx.newPage();
await pg.goto(BASE + "/admin");
const stamp = Date.now().toString(36);
const A = await seedBook(pg, { title: `DL libro A ${stamp}`, pages: 12 });
const B = await seedBook(pg, { title: `DL libro B ${stamp}`, pages: 8 });
await browser.close();

/** A reader account with a cookie jar. */
async function reader(name, { can = true, books = "all" } = {}) {
  const username = `dl-${name}-${stamp}`.slice(0, 32);
  const made = (await admin("/api/admin/users", "POST", { username, display_name: `Lector ${name}`, books })).json;
  await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
  const r = await fetch(BASE + "/api/me/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, password: PW }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (can) await admin(`/api/admin/users/${made.id}`, "PATCH", { can_download: true });
  const call = async (p, method = "GET", body, origin = true) => {
    const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", cookie, ...(origin ? { Origin: BASE } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  };
  return { id: made.id, username, call };
}
const anon = async (p, method = "POST", body) => {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return res.status;
};

// ---- signed out: every new route says 401 ----
t.check("signed out: start 401", (await anon(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 2 })) === 401);
t.check("signed out: pages 401", (await anon(`/api/books/${A.slug}/download/pages`, "POST", { token: "x".repeat(30), pages: [1] })) === 401);
t.check("signed out: finish 401", (await anon(`/api/downloads/${crypto.randomUUID()}/finish`, "POST", { status: "completed" })) === 401);
t.check("signed out: admin log 401", (await anon("/api/admin/downloads", "GET")) === 401);
t.check("signed out: admin csv 401", (await anon("/api/admin/downloads/export", "GET")) === 401);
t.check("signed out: admin page-urls 401", (await anon(`/api/admin/books/${A.id}/page-urls`, "POST", { pages: [1] })) === 401);
t.check("signed out: admin start 401", (await anon("/api/admin/downloads", "POST", { book_id: A.id, from: 1, to: 2 })) === 401);

// ---- no permission: no button (meta says false) and 403 ----
const noperm = await reader("noperm", { can: false });
let r = await noperm.call(`/api/books/${A.slug}/meta`);
t.check("no permission: meta can_download=false", r.status === 200 && r.json.can_download === false, JSON.stringify(r.json));
r = await noperm.call(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 3 });
t.check("no permission: start 403", r.status === 403, r.status);
r = await noperm.call(`/api/books/${A.slug}/download/pages`, "POST", { token: "x".repeat(30), pages: [1] });
t.check("no permission: pages 403", r.status === 403, r.status);

// ---- code-only reader (no account): 401 on the new routes, no button ----
const codes = (await admin(`/api/admin/books/${A.id}/codes`, "POST", { count: 1, label: "dl" })).json;
const c0 = codes.codes?.[0]; const code = typeof c0 === "string" ? c0 : c0?.code ?? c0?.plain;
const un = await fetch(BASE + `/api/books/${A.slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code }) });
const codeCookie = un.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const metaCode = await (await fetch(BASE + `/api/books/${A.slug}/meta`, { headers: { cookie: codeCookie } })).json();
t.check("code-only reader: meta can_download=false", metaCode.can_download === false, JSON.stringify(metaCode));
const codeStart = await fetch(BASE + `/api/books/${A.slug}/download`, { method: "POST", headers: { "Content-Type": "application/json", cookie: codeCookie, Origin: BASE }, body: JSON.stringify({ from: 1, to: 2 }) });
t.check("code-only reader: start 401", codeStart.status === 401, codeStart.status);

// ---- with permission ----
const u1 = await reader("ok1", { books: [A.id] });
const u2 = await reader("ok2", { books: [A.id, B.id] });
r = await u1.call(`/api/books/${A.slug}/meta`);
t.check("permission: meta can_download=true", r.json.can_download === true, JSON.stringify(r.json));
r = await u1.call(`/api/books/${B.slug}/meta`);
t.check("permission but book not theirs: meta 401", r.status === 401, r.status);
r = await u1.call(`/api/books/${A.slug}/download`, "POST", { from: 3, to: 7 });
t.check("start 3-7 -> 200 with id and token", r.status === 200 && r.json.id && r.json.token, JSON.stringify(r.json));
const tok = r.json.token, did = r.json.id;
r = await u1.call(`/api/books/${A.slug}/download`, "POST", { from: 3, to: 7 }, false);
t.check("start without Origin and without Sec-Fetch-Site -> 403", r.status === 403, r.status);
r = await u1.call(`/api/books/${A.slug}/download`, "POST", { from: 5, to: 99 });
t.check("range beyond the book -> 400", r.status === 400, r.status);
r = await u1.call(`/api/books/${A.slug}/download`, "POST", { from: 6, to: 2 });
t.check("range from > to -> 400", r.status === 400, r.status);
r = await u1.call(`/api/books/${B.slug}/download`, "POST", { from: 1, to: 2 });
t.check("book the user cannot read -> 404", r.status === 404, r.status);

r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: [3, 4, 5, 6, 7] });
t.check("pages 3..7 with token -> 5 urls", r.status === 200 && r.json.urls.length === 5, JSON.stringify(r.json)?.slice(0, 120));
if (r.status === 200) {
  const img = await fetch(BASE + r.json.urls[0].url);
  t.check("the URL returns an image", img.status === 200 && /webp/.test(img.headers.get("content-type") ?? ""), img.status);
}
r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: [2] });
t.check("token: page outside the range -> 403", r.status === 403, r.status);
r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: [7, 8] });
t.check("token: one page outside the range -> 403", r.status === 403, r.status);
r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: Array.from({ length: 21 }, (_, i) => i + 1) });
t.check("more than 20 pages -> 400", r.status === 400, r.status);
r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok + "x", pages: [3] });
t.check("tampered token -> 403", r.status === 403, r.status);
r = await u2.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: [3] });
t.check("token of another user -> 403", r.status === 403, r.status);
const tokB = (await u2.call(`/api/books/${B.slug}/download`, "POST", { from: 1, to: 3 })).json.token;
r = await u2.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tokB, pages: [1] });
t.check("token of another book -> 403", r.status === 403, r.status);

// finish: completed once, then it can not be continued or changed
r = await u1.call(`/api/downloads/${did}/finish`, "POST", { status: "completed" });
t.check("finish completed -> 200", r.status === 200, r.status);
r = await u1.call(`/api/downloads/${did}/finish`, "POST", { status: "cancelled" });
t.check("finish again is harmless (200)", r.status === 200, r.status);
r = await u1.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tok, pages: [3] });
t.check("token of a finished download -> 403", r.status === 403, r.status);
r = await u2.call(`/api/downloads/${did}/finish`, "POST", { status: "failed" });
t.check("another user cannot finish my download -> 403", r.status === 403, r.status);
r = await u1.call(`/api/downloads/${crypto.randomUUID()}/finish`, "POST", { status: "failed" });
t.check("unknown download -> 404", r.status === 404, r.status);

// beacon style: text/plain-ish body with no Origin but Sec-Fetch-Site same-origin
const bd = (await u1.call(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 2 })).json;
const beacon = await fetch(BASE + `/api/downloads/${bd.id}/finish`, { method: "POST", headers: { "Content-Type": "application/json", cookie: u1.call.cookie ?? "", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ status: "cancelled" }) });
t.check("beacon without cookie is 401", beacon.status === 401, beacon.status);

// ---- rate limit: 5 per hour, the 6th is refused ----
const lim = await reader("lim", { books: [A.id] });
const codes6 = [];
for (let i = 0; i < 6; i++) codes6.push((await lim.call(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 2 })).status);
t.check("5 downloads ok, the 6th refused (429)", codes6.slice(0, 5).every((s) => s === 200) && codes6[5] === 429, codes6.join(","));

// ---- 1000-page cap needs a big book; the schema caps the range server-side ----
// ---- disabled user ----
const dis = await reader("dis", { books: [A.id] });
const tokD = (await dis.call(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 2 })).json.token;
await admin(`/api/admin/users/${dis.id}`, "PATCH", { disabled: true });
await sleep(100);
r = await dis.call(`/api/books/${A.slug}/download`, "POST", { from: 1, to: 2 });
t.check("disabled user: start refused (401)", r.status === 401, r.status);
r = await dis.call(`/api/books/${A.slug}/download/pages`, "POST", { token: tokD, pages: [1] });
t.check("disabled user: pages refused (401)", r.status === 401, r.status);

// permission removed while a token exists
await admin(`/api/admin/users/${u2.id}`, "PATCH", { can_download: false });
r = await u2.call(`/api/books/${B.slug}/download/pages`, "POST", { token: tokB, pages: [1] });
t.check("permission removed: pages 403", r.status === 403, r.status);

// ---- admin side ----
r = await admin(`/api/admin/books/${A.id}/page-urls`, "POST", { pages: [1, 2, 12] });
t.check("admin page-urls works", r.status === 200 && r.json.urls.length === 3, r.status);
r = await admin(`/api/admin/books/${A.id}/page-urls`, "POST", { pages: [13] });
t.check("admin page-urls beyond the book -> 404", r.status === 404, r.status);
r = await admin(`/api/admin/books/${A.id}/page-urls`, "POST", { pages: Array.from({ length: 21 }, (_, i) => i + 1) });
t.check("admin page-urls max 20 -> 400", r.status === 400, r.status);
const ad = (await admin("/api/admin/downloads", "POST", { book_id: A.id, from: 1, to: 12 })).json;
t.check("admin download is logged", !!ad.id);
await admin(`/api/downloads/${ad.id}/finish`, "POST", { status: "completed" });

const log = (await admin("/api/admin/downloads?size=50")).json;
t.check("log available", log.available === true);
const row = log.rows.find((x) => x.id === did);
t.check("log: user row completed with the right data", row && row.status === "completed" && row.username === u1.username && row.from_page === 3 && row.to_page === 7 && row.page_count === 5 && row.book_title === A.title && row.device === "Ordenador" && row.finished_at, JSON.stringify(row));
const arow = log.rows.find((x) => x.id === ad.id);
t.check("log: admin row has actor admin", arow && arow.actor === "admin" && arow.page_count === 12 && arow.book_total === 12, JSON.stringify(arow));
const mobile = await fetch(BASE + `/api/books/${A.slug}/download`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148", cookie: "" } });
t.check("(device) request without cookie is 401", mobile.status === 401);

// device from the user agent
const um = await reader("mob", { books: [A.id] });
{
  const cookieJar = (await (async () => { const res = await fetch(BASE + "/api/me/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: um.username, password: PW }) }); return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); })());
  const s = await fetch(BASE + `/api/books/${A.slug}/download`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, cookie: cookieJar, "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" }, body: JSON.stringify({ from: 2, to: 3 }) });
  const sid = (await s.json()).id;
  const l2 = (await admin("/api/admin/downloads?size=50")).json;
  t.check("device: iPhone user agent -> Móvil", l2.rows.find((x) => x.id === sid)?.device === "Móvil");
  t.check("log row is 'started' until the browser says otherwise", l2.rows.find((x) => x.id === sid)?.status === "started");
}

// ---- deleting user and book keeps the log readable ----
await admin(`/api/admin/users/${u1.id}`, "DELETE", { username: u1.username });
await admin(`/api/admin/books/${B.id}`, "DELETE", { title: B.title });
const after = (await admin("/api/admin/downloads?size=50")).json;
const kept = after.rows.find((x) => x.id === did);
t.check("deleted user: row kept, snapshot readable", kept && kept.display_name === "Lector ok1" && kept.username === u1.username, JSON.stringify(kept));
const keptB = after.rows.find((x) => x.book_id === B.id);
t.check("deleted book: row kept, title readable", keptB && keptB.book_title === B.title && keptB.book_total === null, JSON.stringify(keptB));
t.check("filters still list the deleted user and book", after.filters.users.some((x) => x.id === u1.id) && after.filters.books.some((x) => x.id === B.id));

// ---- CSV ----
const csv = await fetch(BASE + "/api/admin/downloads/export?" + new URLSearchParams({ user: u1.id }), { headers: { cookie: (await (async () => { const r2 = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: "admin", password: "admin123" }) }); return r2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); })()) } });
const bytes = new Uint8Array(await csv.arrayBuffer());
t.check("csv: UTF-8 BOM", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
const text = new TextDecoder().decode(bytes.slice(3));
t.check("csv: header and accents", text.startsWith("Fecha y hora;Usuario;Libro;Páginas;Nº de páginas;Dispositivo;Estado"), text.slice(0, 80));
t.check("csv: row content", /Lector ok1 \(@dl-ok1/.test(text) && /;3–7;5;Ordenador;Completada/.test(text), text.slice(0, 300));
t.check("csv: content type", /text\/csv; charset=utf-8/.test(csv.headers.get("content-type") ?? ""));
t.done();
