// Contacto, Mensajes, Ajustes legales, the legal pages, the cookie notice, /activar, Exportar datos and Anonimizar.
//   DATA_BACKEND=mock npx next dev -p 3100
//   node e2e/legal.mjs              (SCREENSHOTS=1 also saves light/dark captures at 390 and 1440 px in screenshots/)
// The site without the new tabs is tested by e2e/legal-missing.mjs.
import fs from "node:fs";
import path from "node:path";
import { BASE, PW, SHOTS, adminApi, adminContext, context, counter, launch, sleep, warm } from "./lib.mjs";
import { STORAGE_ITEMS } from "../lib/cookie-inventory.ts";

const t = counter("legal");
const shots = process.env.SCREENSHOTS === "1";
if (shots) fs.mkdirSync(SHOTS, { recursive: true });
const FILE = path.join(process.cwd(), ".data", "mock-sheet.json");
const sheet = () => JSON.parse(fs.readFileSync(FILE, "utf8"));
const stamp = Date.now().toString(36);
const F = '=IMPORTXML("https://example.com","//a")';
const XSS = "<img src=x onerror=alert(1)>";
const net = Math.floor(Math.random() * 200) + 20;
let ipn = 0;
const newIp = () => { ipn++; return `10.${net}.${(ipn >> 8) & 255}.${ipn & 255}`; };

const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
async function formToken() {
  const html = await (await fetch(BASE + "/contacto")).text();
  return /\d{13}\.[\w-]{43}/.exec(html)?.[0] ?? "";
}
const DEF = { name: "Ana Prueba", email: "ana.prueba@example.com", subject: "Sugerencia", message: "Hola, esto es un mensaje de prueba.", consent: true, website: "" };
async function send(fields, { ip = newIp(), origin = BASE, cookie = "", tok } = {}) {
  const r = await fetch(BASE + "/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...(origin ? { Origin: origin } : {}), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ ...DEF, t: tok ?? T, ...fields }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function login(p, data) {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(data) });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function newReader(tag, { canDownload = false } = {}) {
  const username = `${tag}-${stamp}`.slice(0, 32);
  const made = (await api("/api/admin/users", "POST", { username, display_name: `Lectora ${tag} ${stamp}`, books: "all" })).json;
  await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
  if (canDownload) await api(`/api/admin/users/${made.id}`, "PATCH", { can_download: true });
  return { username, id: made.id, display: `Lectora ${tag} ${stamp}`, cookie: await login("/api/me/login", { username, password: PW }) };
}
const messages = async (q = "") => (await api(`/api/admin/messages${q}`)).json;
async function findMsg(pred) {
  for (let page = 1; ; page++) {
    const r = await messages(`?q=${encodeURIComponent(stamp)}&page=${page}`);
    const hit = r.rows.find(pred);
    if (hit || page >= r.pages) return hit;
  }
}

await warm(["/", "/contacto", "/privacidad", "/cookies", "/aviso-legal", "/activar", "/entrar", "/admin"]);
const T = await formToken();
t.check("the form carries a signed load-time stamp", /^\d{13}\.[\w-]{43}$/.test(T), T);

// ================= 1. /api/contact: anti-spam and validation =================
{
  const fresh = await formToken();
  const r = await send({ message: `Demasiado rápido ${stamp}` }, { tok: fresh });
  t.check("sent < 3 s after loading the form: rejected (429, Spanish)", r.status === 429 && /demasiado rápido/.test(r.json?.error ?? ""), JSON.stringify(r));
}
await sleep(3200);
const before = (await messages()).total;
{
  const r = await send({ website: "http://spam.example", message: `Honeypot ${stamp}` });
  t.check("honeypot filled: rejected (400)", r.status === 400 && r.json?.error === "No se ha podido enviar el mensaje.", JSON.stringify(r));
  const o = await send({ message: `Origen ajeno ${stamp}` }, { origin: "https://evil.example" });
  t.check("foreign Origin: rejected (403)", o.status === 403, JSON.stringify(o));
  const f = await send({ message: `Sello falso ${stamp}` }, { tok: `${Date.now() - 10000}.${"A".repeat(43)}` });
  t.check("forged load-time stamp: rejected (400)", f.status === 400 && /caducado/.test(f.json?.error ?? ""), JSON.stringify(f));
  const cases = [
    ["name", { name: "" }], ["name", { name: "x".repeat(81) }], ["email", { email: "no-es-un-email" }], ["email", { email: `${"a".repeat(110)}@example.com` }],
    ["subject", { subject: "Otra cosa" }], ["message", { message: "corto" }], ["message", { message: "x".repeat(2001) }], ["consent", { consent: false }],
  ];
  for (const [field, body] of cases) {
    const v = await send(body);
    const err = v.json?.error ?? "";
    t.check(`invalid ${field} (${JSON.stringify(body).slice(0, 40)}…): 400 with a Spanish error for that field`, v.status === 400 && v.json?.field === field && /^(Escribe|Revisa|Elige|Para|El )/.test(err) && !/invalid|expected|string/i.test(err), JSON.stringify(v.json));
  }
  t.check("nothing rejected was stored", (await messages()).total === before, `${before} -> ${(await messages()).total}`);
}
// rate limit per IP: 3 in 10 minutes
const ip = newIp();
{
  const codes = [];
  for (let i = 1; i <= 4; i++) codes.push((await send({ message: `Límite por IP ${i} ${stamp}` }, { ip })).status);
  const r4 = await send({ message: `Límite por IP 5 ${stamp}` }, { ip });
  t.check("same IP: 3 accepted, the 4th within 10 minutes rejected (429)", codes.join() === "201,201,201,429" && r4.status === 429, codes.join());
  const other = await send({ message: `Otra IP ${stamp}` });
  t.check("another IP is not affected", other.status === 201);
}
// rate limit per account: 5 a day (from different IPs)
const sender = await newReader("msg");
{
  const codes = [];
  for (let i = 1; i <= 6; i++) codes.push((await send({ name: sender.display, email: `${sender.username}@example.com`, message: `Cuenta ${i} ${stamp}` }, { cookie: sender.cookie })).status);
  t.check("same account: 5 a day accepted, the 6th rejected (429)", codes.join() === "201,201,201,201,201,429", codes.join());
  const m = await findMsg((x) => x.message === `Cuenta 1 ${stamp}`);
  t.check("signed in: the message is linked to the account", m?.user_id === sender.id && m?.username === sender.username, JSON.stringify(m));
}
// formulas and HTML are stored and shown as typed
let xssId = "";
{
  const r = await send({ name: F, email: "+1+1@example.com", message: `${F}\n${XSS}\n-2+3 @SUM canción ${stamp}` });
  t.check("a valid message is accepted (201) and the email echoed", r.status === 201 && r.json?.email === "+1+1@example.com", JSON.stringify(r));
  const m = await findMsg((x) => x.name === F);
  xssId = m?.id ?? "";
  t.check("=IMPORTXML(…) in the name is stored literally", m?.name === F, JSON.stringify(m?.name));
  t.check("…and in the message, with the HTML as plain text", m?.message === `${F}\n${XSS}\n-2+3 @SUM canción ${stamp}`);
  t.check("an email starting with + is stored literally", m?.email === "+1+1@example.com");
  t.check("a new message is «nuevo»", m?.status === "nuevo");
  const row = sheet().messages.find((x) => x[0] === xssId) ?? [];
  t.check("sheet row: literal text, status nuevo, created_at ISO", row[2] === F && row[8] === "nuevo" && /^\d{4}-\d\d-\d\dT/.test(row[1]), JSON.stringify(row).slice(0, 200));
  t.check("sheet row: ip_hash is a 32-hex HMAC, never the IP", /^[0-9a-f]{32}$/.test(row[11] ?? "") && !JSON.stringify(sheet().messages).includes(`10.${net}.`), row[11]);
  t.check("admin API never returns ip_hash", !("ip_hash" in (m ?? { ip_hash: 1 })));
  const src = fs.readFileSync("lib/db/sheets.ts", "utf8");
  t.check("real Sheets backend: every write is RAW or a literal stringValue (no USER_ENTERED)", !src.includes("USER_ENTERED") && (src.match(/valueInputOption: "RAW"/g) ?? []).length >= 4);
}

// ================= 2. admin API: list, filters, search, pages, statuses, note, delete =================
{
  const tag = `pag${stamp}`;
  for (let i = 0; i < 51; i++) {
    const r = await send({ name: `Paginación ${i}`, message: `Mensaje ${tag} número ${i}` }, { ip: `10.${net}.200.${Math.floor(i / 3)}` });
    if (r.status !== 201) { t.check(`page fill ${i}`, false, JSON.stringify(r)); break; }
  }
  const p1 = await messages(`?q=${tag}`), p2 = await messages(`?q=${tag}&page=2`);
  t.check("51 matching: 50 on page 1, 1 on page 2", p1.total === 51 && p1.pages === 2 && p1.rows.length === 50 && p2.rows.length === 1, `${p1.total} ${p1.pages} ${p1.rows.length} ${p2.rows.length}`);
  t.check("newest first", p1.rows.every((r, i) => i === 0 || p1.rows[i - 1].created_at >= r.created_at) && p1.rows[0].name === "Paginación 50");
  t.check("search ignores accents and case (cancion → canción)", (await messages(`?q=CANCION%20${stamp}`)).rows.some((r) => r.id === xssId));
  t.check("search by email", (await messages(`?q=${encodeURIComponent(sender.username + "@example.com")}`)).total === 5);
  t.check("filter by status nuevo", (await messages("?status=nuevo")).rows.every((r) => r.status === "nuevo"));
  const all = await messages();
  t.check("unread = messages still «nuevo»", all.unread >= 51 + 5 + 4);
  const id = p1.rows[0].id, path_ = `/api/admin/messages/${id}`;
  const st = async (s) => (await api(path_, "PATCH", { status: s })).json?.message;
  t.check("PATCH leído", (await st("leído"))?.status === "leído");
  const replied = await st("respondido");
  t.check("PATCH respondido sets replied_at", replied?.status === "respondido" && /^\d{4}-/.test(replied?.replied_at ?? ""));
  t.check("PATCH archivado keeps replied_at", (await st("archivado"))?.replied_at === replied?.replied_at);
  t.check("invalid status: 400", (await api(path_, "PATCH", { status: "spam" })).status === 400);
  const noted = (await api(path_, "PATCH", { admin_note: F })).json?.message;
  t.check("private note stored literally", noted?.admin_note === F);
  const anon = await fetch(BASE + path_, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ status: "leído" }) });
  t.check("without the admin cookie: 401", anon.status === 401);
  const evil = await fetch(BASE + path_, { method: "DELETE", headers: { cookie: await login("/api/auth/login", { username: "admin", password: "admin123" }), Origin: "https://evil.example" } });
  t.check("foreign Origin on DELETE: 403", evil.status === 403);
  t.check("DELETE removes it", (await api(path_, "DELETE")).status === 200 && (await api(path_, "PATCH", { status: "leído" })).status === 404);
  const ret = await api("/api/admin/retention", "POST");
  t.check("retention purge runs (admin only, at most daily)", ret.status === 200 && ("skipped" in (ret.json ?? {})), JSON.stringify(ret.json));
}

const browser = await launch();
const pageErrors = [];
const watch = (p) => { p.on("pageerror", (e) => pageErrors.push(String(e))); p.on("dialog", (d) => { pageErrors.push(`dialog: ${d.message()}`); d.dismiss().catch(() => {}); }); };

// ================= 3. /contacto in the browser =================
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const dark of [false, true]) {
    const tag = `${w}-${dark ? "dark" : "light"}`;
    const c = await context(browser, { w, h, dark, touch: w < 800 });
    await c.setExtraHTTPHeaders({ "X-Forwarded-For": newIp() }); // one visitor each (3 messages per 10 minutes per IP)
    const p = await c.newPage(); watch(p);
    await p.goto(BASE + "/contacto"); await p.waitForSelector("[data-testid=contact-form]");
    const email = `ui-${tag}-${stamp}@example.com`;
    await p.fill("#c-name", "María Prueba"); await p.fill("#c-email", email);
    await p.selectOption("#c-subject", "Problema técnico");
    await p.fill("#c-message", "Corto");
    if (!dark && w === 390) t.check("live counter, with the minimum shown", (await p.getByTestId("contact-count").innerText()).startsWith("5 / 2000") && (await p.getByTestId("contact-count").innerText()).includes("mínimo 10"));
    const text = `No puedo abrir el libro desde el móvil (${tag} ${stamp}).`;
    await p.fill("#c-message", text);
    if (!dark && w === 390) {
      t.check("counter follows what is typed", (await p.getByTestId("contact-count").innerText()) === `${text.length} / 2000`);
      await p.getByRole("button", { name: "Enviar mensaje" }).click(); await sleep(400);
      t.check("without the checkbox: Spanish error, nothing sent", (await p.getByTestId("contact-error").innerText()).includes("Política de privacidad"));
      t.check("the privacy checkbox links to /privacidad", (await p.locator("label:has(input[name=consent]) a[href='/privacidad']").count()) === 1);
    }
    await p.check("input[name=consent]");
    if (shots) await p.screenshot({ path: path.join(SHOTS, `contacto-form-${tag}.png`), fullPage: true });
    await sleep(3200);
    await p.getByRole("button", { name: "Enviar mensaje" }).click();
    await p.waitForSelector("[data-testid=contact-sent]", { timeout: 15000 }).catch(() => {});
    const ok = await p.getByTestId("contact-sent").innerText().catch(() => "");
    t.check(`${tag}: «Mensaje enviado. Te responderemos a ${email}.»`, ok.includes(`Mensaje enviado. Te responderemos a ${email}.`), ok);
    if (shots) await p.screenshot({ path: path.join(SHOTS, `contacto-enviado-${tag}.png`), fullPage: true });
    await c.close();
  }
}
{
  // an error keeps what was typed: sending too fast
  const c = await context(browser, { w: 390, h: 844 }); const p = await c.newPage(); watch(p);
  await p.goto(BASE + "/contacto"); await p.waitForSelector("[data-testid=contact-form]");
  await p.fill("#c-name", "Rápida"); await p.fill("#c-email", "rapida@example.com"); await p.fill("#c-message", `Escrito muy deprisa ${stamp}`); await p.check("input[name=consent]");
  await p.getByRole("button", { name: "Enviar mensaje" }).click(); await p.waitForSelector("[data-testid=contact-error]");
  t.check("too fast in the UI: Spanish error and the text is kept", (await p.getByTestId("contact-error").innerText()).includes("demasiado rápido") && (await p.inputValue("#c-message")) === `Escrito muy deprisa ${stamp}` && (await p.inputValue("#c-name")) === "Rápida");
  await c.close();
  // signed in: the name is filled in and the account is shown
  const r = await newReader("form");
  const s = await context(browser, { w: 390, h: 844 });
  await s.addCookies([{ name: "br_u", value: r.cookie.split("br_u=")[1].split(";")[0], url: BASE }]);
  const sp = await s.newPage(); watch(sp);
  await sp.goto(BASE + "/contacto"); await sp.waitForSelector("[data-testid=contact-account]");
  t.check("signed in: name prefilled and the account named", (await sp.inputValue("#c-name")) === r.display && (await sp.getByTestId("contact-account").innerText()).includes(r.username));
  await s.close();
}

// ================= 4. admin «Mensajes» =================
{
  const XSS_BODY = `${F}\n${XSS}\n-2+3 @SUM canción ${stamp}`;
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const dark of [false, true]) {
      const tag = `${w}-${dark ? "dark" : "light"}`;
      const main = w === 1440 && !dark;
      const c = await adminContext(browser, { w, h, dark, touch: w < 800 });
      if (main) await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
      const p = await c.newPage(); watch(p);
      await p.goto(BASE + "/admin"); await p.waitForSelector("[role=tab]");
      const unread = (await messages()).unread;
      await p.waitForSelector("[data-testid=unread-badge]", { timeout: 10000 }).catch(() => {});
      const badge = async () => [await p.getByTestId("unread-badge").innerText().catch(() => ""), await p.getByTestId("unread-badge").getAttribute("aria-label").catch(() => "")];
      const shows = (n) => JSON.stringify([n > 99 ? "99+" : String(n), `${n} sin leer`]);
      if (main) t.check(`badge in the admin navigation shows the unread count (${unread})`, JSON.stringify(await badge()) === shows(unread), JSON.stringify(await badge()));
      await p.getByRole("tab", { name: /Mensajes/ }).click();
      await p.waitForSelector("[data-testid=messages-list]");
      if (main) t.check("list: newest first", (await p.locator("[data-testid=messages-list] > li").first().getAttribute("data-id")) === (await messages()).rows[0].id);
      if (shots) await p.screenshot({ path: path.join(SHOTS, `admin-mensajes-${tag}.png`), fullPage: false });
      // search for the message with a formula and HTML in it
      await p.fill("#msg-q", `cancion ${stamp}`); await sleep(900);
      const li = p.locator(`[data-testid=messages-list] > li[data-id="${xssId}"]`);
      if (main) {
        t.check("search box finds it (accents ignored)", (await li.count()) === 1 && (await p.locator("[data-testid=messages-list] > li").count()) === 1);
        t.check("it is «nuevo» before opening", (await li.getAttribute("data-status")) === "nuevo");
        await li.locator("> button").click();
        await p.waitForSelector("[data-testid=message-detail]");
        await sleep(800);
        t.check("opening marks it «leído» (list and sheet)", (await li.getAttribute("data-status")) === "leído" && (await findMsg((x) => x.id === xssId))?.status === "leído");
        t.check("badge goes down by one", JSON.stringify(await badge()) === shows(unread - 1), JSON.stringify(await badge()));
        const shown = await p.getByTestId("message-text").evaluate((e) => ({ text: e.textContent, imgs: e.querySelectorAll("img").length, html: e.innerHTML }));
        t.check("message shown as plain text: =IMPORTXML(…) and <img …> visible, no element created", shown.text === XSS_BODY && shown.imgs === 0 && shown.html.includes("&lt;img"), JSON.stringify(shown));
        t.check("no script ran (no alert, no page error)", pageErrors.length === 0, pageErrors.join(" | "));
        const href = await p.getByTestId("message-mailto").getAttribute("href");
        const u = new URL(href);
        t.check("Responder por email: mailto with «Re: {asunto}»", u.protocol === "mailto:" && decodeURIComponent(u.pathname) === "+1+1@example.com" && u.searchParams.get("subject") === "Re: Sugerencia", href.slice(0, 120));
        t.check("…and the original quoted", (u.searchParams.get("body") ?? "").includes(`> ${F}\n> ${XSS}\n> -2+3`));
        await p.getByRole("button", { name: "Copiar email" }).click(); await sleep(300);
        t.check("Copiar email copies the address", (await p.evaluate(() => navigator.clipboard.readText())) === "+1+1@example.com");
        await p.fill(`#note-${xssId}`, `Contestado por teléfono ${F}`);
        await p.getByRole("button", { name: "Guardar nota" }).click(); await sleep(700);
        t.check("private note saved (literally)", (await findMsg((x) => x.id === xssId))?.admin_note === `Contestado por teléfono ${F}`);
        if (shots) await p.screenshot({ path: path.join(SHOTS, `admin-mensaje-detalle-${tag}.png`), fullPage: false });
        await p.getByRole("button", { name: "Marcar como respondido" }).click(); await sleep(700);
        const m1 = await findMsg((x) => x.id === xssId);
        t.check("Marcar como respondido: status and replied_at", m1?.status === "respondido" && !!m1?.replied_at && (await li.getAttribute("data-status")) === "respondido");
        await p.getByRole("button", { name: "Archivar" }).click(); await sleep(700);
        t.check("Archivar", (await findMsg((x) => x.id === xssId))?.status === "archivado");
        await p.selectOption("#msg-status", "archivado"); await sleep(800);
        t.check("filter Archivados shows it", (await li.count()) === 1);
        await p.selectOption("#msg-status", "nuevo"); await sleep(800);
        t.check("filter Nuevos hides it", (await li.count()) === 0);
        await p.selectOption("#msg-status", ""); await sleep(800);
        await li.locator("> button").click(); await p.waitForSelector("[data-testid=message-detail]");
        await p.getByRole("button", { name: "Eliminar", exact: true }).click();
        await p.waitForSelector("dialog[open]");
        t.check("Eliminar asks for confirmation", (await p.locator("dialog[open]").innerText()).includes("de forma permanente"));
        await p.locator("dialog[open]").getByRole("button", { name: "Eliminar para siempre" }).click(); await sleep(1000);
        t.check("deleted after confirming", (await findMsg((x) => x.id === xssId)) === undefined && (await li.count()) === 0);
      } else {
        // screenshots of a detail in the other sizes/themes: open the newest UI message
        await p.fill("#msg-q", `${stamp}`); await sleep(900);
        await p.locator("[data-testid=messages-list] > li > button").first().click(); await p.waitForSelector("[data-testid=message-detail]"); await sleep(500);
        if (shots) await p.screenshot({ path: path.join(SHOTS, `admin-mensaje-detalle-${tag}.png`), fullPage: false });
      }
      await c.close();
    }
  }
}

// ================= 5. Ajustes legales and the legal pages =================
const today = new Date();
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const todayLong = `${today.getDate()} de ${months[today.getMonth()]} de ${today.getFullYear()}`;
const LEGAL_PAGES = ["/privacidad", "/cookies", "/aviso-legal"];
async function pageText(p, url) {
  await p.goto(BASE + url); await p.waitForSelector("[data-testid=legal-page]");
  return p.evaluate(() => ({
    text: document.querySelector("[data-testid=legal-page]").innerText,
    owner: [...document.querySelectorAll("[data-testid=legal-owner] dt")].map((d) => d.textContent),
    date: document.querySelector("[data-testid=legal-date]")?.textContent ?? "",
  }));
}
{
  await api("/api/admin/settings", "PUT", { owner: "", email: "", city: "" });
  const c = await adminContext(browser, { w: 1440, h: 900 }); const p = await c.newPage(); watch(p);
  await p.goto(BASE + "/admin"); await p.waitForSelector("[role=tab]");
  await p.waitForSelector("[data-testid=legal-banner]", { timeout: 8000 }).catch(() => {});
  t.check("empty legal details: «Completa los datos legales» banner", (await p.getByTestId("legal-banner").innerText().catch(() => "")).includes("Completa los datos legales"));
  // public pages with nothing filled in: no placeholders, those lines are left out
  const pub = await context(browser, { w: 1440, h: 900 }); const pp = await pub.newPage();
  for (const url of LEGAL_PAGES) {
    const r = await pageText(pp, url);
    t.check(`${url} empty: no Responsable/Email/Ciudad lines, only the form`, r.owner.join() === "Formulario", r.owner.join());
    const ph = /undefined|\bnull\b|\[|\{|XXX|\bTODO\b|lorem|<(?!libro>|usuario>)[a-z]/i; // <libro> is part of the cookie names
    t.check(`${url} empty: no placeholder text`, !ph.test(r.text), r.text.match(ph)?.[0]);
  }
  t.check("/privacidad empty: rights go to the contact form", (await pageText(pp, "/privacidad")).text.includes("escríbenos desde el formulario de Contacto"));
  await p.getByRole("button", { name: "Ir a Ajustes legales" }).click();
  await p.waitForSelector("[data-testid=legal-panel]");
  await p.fill("#legal-email", "esto-no-es-un-email"); await p.getByRole("button", { name: "Guardar" }).click(); await sleep(600);
  t.check("invalid email: Spanish error", (await p.locator("[data-testid=legal-panel] [role=alert]").innerText().catch(() => "")).includes("Revisa el email"));
  await p.fill("#legal-owner", "María García López (NIF 00000000T)"); await p.fill("#legal-email", "contacto@example.com"); await p.fill("#legal-city", F);
  await p.getByRole("button", { name: "Guardar" }).click(); await sleep(900);
  t.check("saved: «Última actualización» is today", (await p.getByTestId("legal-updated").innerText()).includes(`Última actualización: ${todayLong}`), await p.getByTestId("legal-updated").innerText());
  t.check("a formula in a setting is stored literally", sheet().settings.find((r) => r[0] === "legal_city")?.[1] === F);
  await p.getByRole("tab", { name: "Libros" }).click(); await sleep(400);
  t.check("filled: the banner is gone", (await p.getByTestId("legal-banner").count()) === 0);
  await p.getByRole("tab", { name: "Ajustes legales" }).click(); await p.waitForSelector("[data-testid=legal-panel]");
  await p.fill("#legal-city", "Madrid"); await p.getByRole("button", { name: "Guardar" }).click(); await sleep(900);
  for (const url of LEGAL_PAGES) {
    const r = await pageText(pp, url);
    t.check(`${url} filled: owner, city and email, and today's date`, r.owner.join() === "Responsable,Ciudad,Email,Formulario" && r.text.includes("María García López (NIF 00000000T)") && r.text.includes("contacto@example.com") && r.text.includes("Madrid") && r.date === `Última actualización: ${todayLong}`, `${r.owner} | ${r.date}`);
  }
  t.check("/privacidad filled: rights by email", (await pageText(pp, "/privacidad")).text.includes("escribe a contacto@example.com"));
  const priv = (await pageText(pp, "/privacidad")).text;
  for (const s of ["nombre de usuario", "hash", "clave pública", "Progreso de lectura", "Marcadores", "Historial de descargas", "tipo de dispositivo", "Mensajes de contacto", "dirección IP", "Códigos de acceso", "6.1.b", "6.1.f", "6.1.a", "Vercel", "Google", "Cloudflare", "Data Privacy Framework", "cláusulas contractuales tipo", "12 meses", "www.aepd.es", "14 años", "portabilidad", "oponerte", "limitación", "supresión", "rectificación", "acceso"])
    t.check(`/privacidad mentions «${s}»`, priv.includes(s));
  const aviso = (await pageText(pp, "/aviso-legal")).text;
  for (const s of ["LSSI-CE", "Propiedad intelectual", "Responsabilidad", "ley española"]) t.check(`/aviso-legal mentions «${s}»`, aviso.includes(s));
  // without the city: that line goes
  await p.fill("#legal-city", ""); await p.getByRole("button", { name: "Guardar" }).click(); await sleep(900);
  t.check("city emptied: the Ciudad line is left out", (await pageText(pp, "/aviso-legal")).owner.join() === "Responsable,Email,Formulario");
  await p.fill("#legal-city", "Madrid"); await p.getByRole("button", { name: "Guardar" }).click(); await sleep(900);
  await pub.close(); await c.close();
  if (shots) {
    for (const [w, h] of [[390, 844], [1440, 900]]) for (const dark of [false, true]) {
      const tag = `${w}-${dark ? "dark" : "light"}`;
      const a = await adminContext(browser, { w, h, dark, touch: w < 800 }); const ap = await a.newPage();
      await ap.goto(BASE + "/admin"); await ap.waitForSelector("[role=tab]"); await ap.getByRole("tab", { name: "Ajustes legales" }).click(); await ap.waitForSelector("[data-testid=legal-panel]"); await sleep(400);
      await ap.screenshot({ path: path.join(SHOTS, `admin-ajustes-legales-${tag}.png`), fullPage: true }); await a.close();
      const v = await context(browser, { w, h, dark, touch: w < 800 }); const vp = await v.newPage();
      for (const url of LEGAL_PAGES) { await vp.goto(BASE + url); await vp.waitForSelector("[data-testid=legal-page]"); await sleep(300); await vp.screenshot({ path: path.join(SHOTS, `${url.slice(1)}-${tag}.png`), fullPage: true }); }
      await v.close();
    }
  }
}

// ================= 6. cookie table vs. what a real visit stores =================
const shown = await (async () => {
  const c = await context(browser, { w: 1440, h: 900 }); const p = await c.newPage();
  await p.goto(BASE + "/cookies"); await p.waitForSelector("[data-storage]");
  const rows = await p.locator("[data-storage]").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("data-storage"), kind: e.getAttribute("data-kind"), scope: e.getAttribute("data-scope") })));
  const text = await p.getByTestId("legal-page").innerText();
  await c.close();
  return { rows, text };
})();
t.check("/cookies lists every item of lib/cookie-inventory.ts", JSON.stringify(shown.rows.map((r) => r.name)) === JSON.stringify(STORAGE_ITEMS.map((i) => i.name)));
t.check("/cookies: says there are no analytics or advertising cookies", shown.text.includes("No usa cookies de análisis ni de publicidad"));
t.check("/cookies: every item is «Técnica necesaria» or «Preferencia»", STORAGE_ITEMS.every((i) => i.type === "Técnica necesaria" || i.type === "Preferencia"));

async function recorder(c) {
  const seen = new Map(); // "kind name" -> true
  const add = (kind, name) => seen.set(`${kind}\t${name}`, true);
  await c.exposeBinding("__recordStorage", (_src, kind, name) => add(kind, name));
  await c.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      try { window.__recordStorage(this === window.localStorage ? "localStorage" : "sessionStorage", String(k)); } catch { /* ignore */ }
      return set.call(this, k, v);
    };
    if (window.IDBFactory) {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (n, ...rest) { try { window.__recordStorage("IndexedDB", String(n)); } catch { /* ignore */ } return open.call(this, n, ...rest); };
    }
    try { if (document.cookie) for (const kv of document.cookie.split(";")) window.__recordStorage("Cookie", kv.split("=")[0].trim()); } catch { /* ignore */ }
  });
  c.on("response", async (r) => {
    try {
      for (const h of await r.headersArray()) {
        if (h.name.toLowerCase() !== "set-cookie") continue;
        for (const line of h.value.split("\n")) {
          const [nv, ...attrs] = line.split(";");
          const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /^\s*expires=.*1970/i.test(a));
          if (!gone) add("Cookie", nv.split("=")[0].trim());
        }
      }
    } catch { /* ignore */ }
  });
  return { seen, add, async final(p) {
    for (const ck of await c.cookies()) add("Cookie", ck.name);
    for (const k of await p.evaluate(() => Object.keys(localStorage))) add("localStorage", k);
    for (const k of await p.evaluate(() => Object.keys(sessionStorage))) add("sessionStorage", k);
    for (const k of await p.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []))) add("IndexedDB", k);
  } };
}
const match = (kind, name) => STORAGE_ITEMS.find((i) => i.kind === kind && new RegExp(i.pattern).test(name));
{
  const books = (await api("/api/admin/books")).json.books.filter((b) => b.status === "published");
  const textBook = books.find((b) => /^ocr-/.test(b.slug)) ?? books.find((b) => /^texto-/.test(b.slug)) ?? books[0];
  const lockBook = books.find((b) => b.slug === "libro-semilla-b") ?? books[1];
  const codeRes = (await api(`/api/admin/books/${lockBook.id}/codes`, "POST", { count: 1, label: `legal ${stamp}` })).json;
  const c0 = codeRes.codes?.[0]; const code = typeof c0 === "string" ? c0 : c0?.code ?? c0?.plain;
  const rd = await newReader("rec", { canDownload: true });
  // a plain browser: nothing preset, so everything stored comes from the site
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const rec = await recorder(c);
  const p = await c.newPage(); watch(p);
  const cdp = await c.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const step = [];
  // first visit: the notice, then the theme
  await p.goto(BASE + "/"); await p.waitForSelector("[data-testid=cookie-notice]");
  await p.getByRole("button", { name: "Entendido" }).click(); step.push("notice dismissed");
  await p.locator("button[aria-label^='Cambiar a tema']").first().click(); step.push("theme toggled");
  // unlock a book with a code (signed out) and read
  await p.goto(`${BASE}/b/${lockBook.slug}`); await p.fill("#code", code); await p.getByRole("button", { name: "Abrir libro" }).click();
  await p.waitForSelector("header[role=toolbar]", { timeout: 30000 }); await sleep(2500);
  await p.keyboard.press("ArrowRight"); await sleep(1500);
  await p.getByTestId("bookmark-toggle").click(); await sleep(500); step.push(`unlocked ${lockBook.slug} with a code, read and bookmarked (signed out)`);
  // sign in, and accept the Face ID / huella offer (virtual authenticator)
  await p.goto(BASE + "/entrar"); await p.fill("#username", rd.username); await p.fill("#password", PW);
  await p.getByRole("button", { name: "Entrar", exact: true }).click();
  await p.getByRole("button", { name: "Activar" }).click({ timeout: 15000 }).catch(() => {});
  await p.waitForURL((u) => u.pathname === "/", { timeout: 20000 }).catch(() => {}); await sleep(800); step.push("signed in + passkey activated");
  // read a book with text: modes, effect, select text, bookmark, turn pages, download
  await p.goto(`${BASE}/b/${textBook.slug}#leer`); await p.waitForSelector("header[role=toolbar]", { timeout: 30000 }); await sleep(2500);
  await p.locator("[role=radiogroup][aria-label='Modo de lectura'] [role=radio]", { hasText: "PDF" }).click(); await sleep(1200);
  await p.locator("[role=radiogroup][aria-label='Modo de lectura'] [role=radio]", { hasText: "Libro" }).click(); await sleep(1500);
  await p.locator("button[aria-label='Efecto de página']").first().click(); await p.getByRole("menuitemradio", { name: "Deslizar" }).or(p.locator("[role=menu] button", { hasText: "Deslizar" })).first().click().catch(() => {}); await sleep(500);
  await p.getByTestId("select-text").click().catch(() => {}); await sleep(300);
  await p.getByTestId("bookmark-toggle").click(); await sleep(300);
  await p.keyboard.press("ArrowRight"); await sleep(1500);
  await p.getByTestId("download-open").first().click();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }).catch(() => null), p.locator("dialog[open]").getByRole("button", { name: "Descargar PDF" }).click()]);
  step.push(`read ${textBook.slug} (modes, effect, select, bookmark, pages) and ${dl ? "downloaded a PDF" : "DOWNLOAD FAILED"}`);
  await sleep(6500); // bookmarks go out after a quiet moment
  await p.goto(BASE + "/"); await sleep(800);
  await rec.final(p);
  await c.close();
  // the admin browser: signing in to /admin
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const arec = await recorder(a); const ap = await a.newPage();
  await ap.goto(BASE + "/admin/login"); await ap.fill("#username", "admin"); await ap.fill("#password", "admin123"); await ap.getByRole("button", { name: "Entrar" }).click();
  await ap.waitForSelector("[role=tab]", { timeout: 20000 }); await sleep(1500); await arec.final(ap); await a.close();

  const recorded = [...rec.seen.keys()].map((k) => k.split("\t")).sort();
  const adminRecorded = [...arec.seen.keys()].map((k) => k.split("\t")).sort();
  console.log("\n  Steps:", step.join(" → "));
  console.log("\n  Cookie table on /cookies (lib/cookie-inventory.ts):");
  for (const i of STORAGE_ITEMS) console.log(`    [${i.scope}] ${i.kind.padEnd(12)} ${i.name.padEnd(36)} ${i.type}`);
  console.log("\n  Recorded in the browser (reader visit):");
  for (const [k, n] of recorded) console.log(`    ${k.padEnd(14)} ${n.padEnd(48)} -> ${match(k, n)?.name ?? "NOT IN THE TABLE"}`);
  console.log("\n  Recorded in the browser (admin sign-in):");
  for (const [k, n] of adminRecorded) console.log(`    ${k.padEnd(14)} ${n.padEnd(48)} -> ${match(k, n)?.name ?? "NOT IN THE TABLE"}`);
  const unlisted = [...recorded, ...adminRecorded].filter(([k, n]) => !match(k, n));
  t.check("everything the browser stored is in the cookie table", unlisted.length === 0, JSON.stringify(unlisted));
  const hit = new Set(recorded.map(([k, n]) => match(k, n)?.name).filter(Boolean));
  const missing = STORAGE_ITEMS.filter((i) => i.scope === "reader" && !hit.has(i.name)).map((i) => i.name);
  t.check("every reader item of the table was really stored during the visit (exact match)", missing.length === 0, JSON.stringify(missing));
  t.check("nothing of the reader visit is an admin-only item", recorded.every(([k, n]) => match(k, n)?.scope !== "admin"));
  t.check("admin sign-in stores br_admin (listed as admin-only)", adminRecorded.some(([k, n]) => k === "Cookie" && n === "br_admin") && match("Cookie", "br_admin")?.scope === "admin");
  t.check("no sessionStorage is used", ![...recorded, ...adminRecorded].some(([k]) => k === "sessionStorage"));
  // export of this reader: account, progress, bookmarks, downloads, messages, no hashes
  await send({ name: rd.display, email: `${rd.username}@example.com`, message: `Exportación ${stamp}` }, { cookie: rd.cookie });
  const r = await fetch(`${BASE}/api/admin/users/${rd.id}/export`, { headers: { cookie: await login("/api/auth/login", { username: "admin", password: "admin123" }) } });
  const raw = await r.text();
  let data = null; try { data = JSON.parse(raw); } catch { /* checked below */ }
  t.check("Exportar datos: a JSON attachment", r.status === 200 && /attachment; filename="?datos-/.test(r.headers.get("content-disposition") ?? "") && !!data, r.headers.get("content-disposition"));
  const keys = []; const walk = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } }; walk(data);
  const userRow = sheet().users.find((u) => u[0] === rd.id) ?? [];
  const pkRow = sheet().passkeys.find((x) => x[1] === rd.id) ?? [];
  t.check("export: no key named *hash*, password or ip", !keys.some((k) => /hash|password|^ip/i.test(k)), keys.filter((k) => /hash|password|^ip/i.test(k)).join());
  t.check("export: the password hash and passkey public key are not in it", !!userRow[3] && !raw.includes(userRow[3]) && (!pkRow[3] || !raw.includes(pkRow[3])));
  t.check("export: account info", data?.account?.username === rd.username && data?.account?.display_name === rd.display);
  t.check("export: progress, bookmarks, downloads, messages", data?.progress?.length >= 1 && data?.bookmarks?.length >= 1 && data?.downloads?.length >= 1 && data?.messages?.length >= 1,
    JSON.stringify({ p: data?.progress?.length, b: data?.bookmarks?.length, d: data?.downloads?.length, m: data?.messages?.length }));
  t.check("export: no ip_hash in its messages", data?.messages?.every((m) => !("ip_hash" in m)));

  // ================= 7. delete with «Anonimizar…» =================
  const keep = await newReader("keep");
  await send({ name: keep.display, email: `${keep.username}@example.com`, message: `No anonimizar ${stamp}` }, { cookie: keep.cookie });
  for (const [u, anon] of [[rd, true], [keep, false]]) {
    const ac = await adminContext(browser, { w: 1440, h: 900 }); const pg = await ac.newPage(); watch(pg);
    await pg.goto(BASE + "/admin"); await pg.getByRole("tab", { name: "Usuarios" }).click();
    const row = pg.locator("li", { hasText: u.username }).first(); await row.waitFor();
    if (anon) t.check("Usuarios: «Exportar datos» link", (await row.getByTestId("export-user").getAttribute("href")) === `/api/admin/users/${u.id}/export`);
    await row.getByRole("button", { name: "Eliminar", exact: true }).click();
    const dlg = pg.locator("dialog[open]");
    await dlg.locator("input.field").fill(u.username);
    if (anon) { t.check("delete dialog: «Anonimizar también su historial de descargas y mensajes»", (await dlg.innerText()).includes("Anonimizar también su historial de descargas y mensajes")); await dlg.getByTestId("delete-anon").check(); }
    await dlg.getByRole("button", { name: "Eliminar para siempre" }).click();
    await dlg.waitFor({ state: "detached", timeout: 30000 }).catch(() => {}); await sleep(500);
    await ac.close();
  }
  const s = sheet();
  const text = JSON.stringify(s);
  t.check("deleted with Anonimizar: no username, name or email left anywhere in the sheet", !text.includes(rd.username) && !text.includes(rd.display), [rd.username, rd.display].filter((x) => text.includes(x)).join());
  const dlRows = s.downloads.filter((r) => r[2] === rd.id), msgRows = s.messages.filter((r) => r[6] === rd.id);
  t.check("…its downloads say «Usuario eliminado»", dlRows.length >= 1 && dlRows.every((r) => r[3] === "Usuario eliminado" && r[4] === "Usuario eliminado"), JSON.stringify(dlRows[0]));
  t.check("…its messages say «Usuario eliminado» (name, username, email)", msgRows.length >= 1 && msgRows.every((r) => r[2] === "Usuario eliminado" && r[3] === "Usuario eliminado" && r[7] === "Usuario eliminado"), JSON.stringify(msgRows[0]));
  t.check("…its account, progress and bookmarks are gone", !s.users.some((r) => r[0] === rd.id) && !s.progress.some((r) => r[0] === rd.id) && !s.bookmarks.some((r) => r[1] === rd.id));
  t.check("deleted without it: the history keeps the name (as before)", s.messages.some((r) => r[6] === keep.id && r[2] === keep.display));
}

// ================= 8. the cookie notice =================
{
  for (const w of [320, 360, 390, 768, 1024, 1280, 1440]) {
    const c = await context(browser, { w, h: 800, notice: true, touch: w < 800 }); const p = await c.newPage();
    for (const url of ["/", "/contacto", "/privacidad"]) {
      await p.goto(BASE + url); await p.waitForSelector("[data-testid=cookie-notice]");
      const m = await p.evaluate(() => {
        const n = document.querySelector("[data-testid=cookie-notice]").getBoundingClientRect(); const de = document.documentElement;
        return { sw: Math.max(de.scrollWidth, document.body.scrollWidth), iw: de.clientWidth, l: n.left, r: n.right, b: n.bottom, ih: innerHeight, h: n.height };
      });
      t.check(`${w}px ${url}: notice inside the screen, no horizontal overflow`, m.sw <= m.iw && m.l >= 0 && m.r <= m.iw && m.b <= m.ih && m.h < 260, JSON.stringify(m));
    }
    t.check(`${w}px: the notice text and links`, (await p.getByTestId("cookie-notice").innerText()).includes("Este sitio solo usa cookies técnicas necesarias y preferencias guardadas en tu dispositivo.") && (await p.getByTestId("cookie-notice").getByRole("link", { name: "Más información" }).getAttribute("href")) === "/cookies");
    if (shots && (w === 390 || w === 1440)) for (const dark of [false, true]) {
      const d = await context(browser, { w, h: w < 800 ? 844 : 900, notice: true, dark, touch: w < 800 }); const dp = await d.newPage();
      await dp.goto(BASE + "/"); await dp.waitForSelector("[data-testid=cookie-notice]"); await sleep(500);
      await dp.screenshot({ path: path.join(SHOTS, `aviso-cookies-${w}-${dark ? "dark" : "light"}.png`) }); await d.close();
    }
    await p.getByRole("button", { name: "Entendido" }).click(); await sleep(200);
    t.check(`${w}px: Entendido closes it`, (await p.getByTestId("cookie-notice").count()) === 0);
    await p.reload(); await sleep(1200);
    t.check(`${w}px: remembered after a reload`, (await p.getByTestId("cookie-notice").count()) === 0 && (await p.evaluate(() => localStorage.getItem("br:cookies"))) === "1");
    await c.close();
  }
  // never over the reader nor in the admin
  const r = await newReader("notice");
  const c = await context(browser, { w: 390, h: 844, notice: true }); await c.addCookies([{ name: "br_u", value: r.cookie.split("br_u=")[1].split(";")[0], url: BASE }]);
  const p = await c.newPage();
  const slug = (await api("/api/admin/books")).json.books.find((b) => b.status === "published").slug;
  await p.goto(`${BASE}/b/${slug}#leer`); await p.waitForSelector("header[role=toolbar]", { timeout: 30000 }); await sleep(1500);
  t.check("reader open: the notice is not shown", !(await p.getByTestId("cookie-notice").isVisible().catch(() => false)));
  await c.close();
  const ac = await adminContext(browser, { w: 390, h: 844, notice: true }); const apg = await ac.newPage();
  await apg.goto(BASE + "/admin"); await apg.waitForSelector("[role=tab]"); await sleep(800);
  t.check("admin: the notice is not shown", (await apg.getByTestId("cookie-notice").count()) === 0);
  await ac.close();
}

// ================= 9. /activar needs the privacy checkbox =================
{
  const username = `act-${stamp}`.slice(0, 32);
  const made = (await api("/api/admin/users", "POST", { username, display_name: "Activación", books: "all" })).json;
  const c = await context(browser, { w: 390, h: 844 }); const p = await c.newPage(); watch(p);
  await p.goto(BASE + "/activar");
  await p.fill("#username", username); await p.fill("#code", made.code); await p.fill("#new-password", PW); await p.fill("#confirm-password", PW);
  const btn = p.getByRole("button", { name: "Activar cuenta" });
  t.check("/activar: the checkbox links to /privacidad", (await p.locator("label:has(#accept-privacy) a[href='/privacidad']").count()) === 1);
  t.check("/activar: not accepted → «Activar cuenta» disabled", await btn.isDisabled());
  await p.check("#accept-privacy");
  t.check("/activar: accepted → enabled", await btn.isEnabled());
  await btn.click(); await sleep(2500);
  const u = (await api("/api/admin/users")).json.users.find((x) => x.username === username);
  t.check("/activar with the checkbox: account active", u?.status === "active", u?.status);
  await c.close();
}

await browser.close();
t.check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
t.done();
