// The site on a Sheet without the `messages` and `settings` tabs (before "Actualizar base de datos"), then after it.
//   MOCK_MISSING_TABS=messages,settings DATA_BACKEND=mock npx next dev -p 3100
//   node e2e/legal-missing.mjs
// The mock keeps the simulated header row in memory: restart the server to run this again.
import { BASE, PW, adminApi, adminContext, context, counter, launch, sleep, warm } from "./lib.mjs";

const t = counter("legal-missing");
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const before = (await api("/api/admin/maintenance")).json?.tabs ?? [];
const exists = (tab) => before.find((x) => x.tab === tab)?.exists;
if (exists("messages") || exists("settings")) { console.log("Start the server with MOCK_MISSING_TABS=messages,settings (and restart it to repeat)."); process.exit(1); }
await warm(["/", "/contacto", "/privacidad", "/cookies", "/aviso-legal", "/admin"]);

const stamp = Date.now().toString(36);
const username = `mis-${stamp}`.slice(0, 32);
const made = (await api("/api/admin/users", "POST", { username, display_name: "Sin pestañas", books: "all" })).json;
await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username, code: made.code, password: PW }) });
const pub = (await api("/api/admin/books")).json.books.find((b) => b.status === "published");

// ---- API without the tabs ----
{
  const c = await fetch(BASE + "/api/contact", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ name: "A", email: "a@example.com", subject: "Otro", message: "Mensaje de prueba sin pestaña", consent: true, website: "", t: "x" }) });
  t.check("POST /api/contact: 503 with a Spanish message", c.status === 503 && /aún no está disponible/.test((await c.json()).error), c.status);
  const m = await api("/api/admin/messages");
  t.check("GET /api/admin/messages: available false, empty", m.status === 200 && m.json.available === false && m.json.rows.length === 0 && m.json.unread === 0);
  t.check("PATCH a message: 409 «Actualiza la base de datos en Mantenimiento.»", (await api("/api/admin/messages/x", "PATCH", { status: "leído" })).json?.error === "Actualiza la base de datos en Mantenimiento.");
  const s = await api("/api/admin/settings");
  t.check("GET /api/admin/settings: available false", s.status === 200 && s.json.available === false);
  t.check("PUT settings: 409", (await api("/api/admin/settings", "PUT", { owner: "X", email: "", city: "" })).status === 409);
  const e = await fetch(`${BASE}/api/admin/users/${made.id}/export`, { headers: { cookie: (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: "admin", password: "admin123" }) })).headers.getSetCookie().map((x) => x.split(";")[0]).join("; ") } });
  const data = await e.json().catch(() => null);
  t.check("Exportar datos still works (no messages)", e.status === 200 && data?.account?.username === username && Array.isArray(data?.messages) && data.messages.length === 0);
  const an = await api(`/api/admin/users/${made.id}/anonymize`, "POST", {});
  t.check("Anonimizar still works (messages 0)", an.status === 200 && an.json.messages === 0);
  t.check("retention still works", (await api("/api/admin/retention", "POST")).status === 200);
}

const browser = await launch();
const errors = [];
{
  const c = await context(browser, { w: 390, h: 844, notice: true }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  // networkidle: the next navigation never races the previous page's hydration (which would make goto return null)
  for (const url of ["/", `/b/${pub.slug}`]) { const r = await p.goto(BASE + url, { waitUntil: "networkidle" }); t.check(`${url} works`, r?.status() === 200, String(r?.status())); }
  t.check("the cookie notice still shows", !!(await p.waitForSelector("[data-testid=cookie-notice]", { timeout: 10000 }).catch(() => null)));
  await p.goto(BASE + "/contacto");
  t.check("/contacto: «estará disponible muy pronto», no form", (await p.locator("main").innerText()).includes("El formulario de contacto estará disponible muy pronto.") && (await p.getByTestId("contact-form").count()) === 0);
  for (const url of ["/privacidad", "/cookies", "/aviso-legal"]) {
    const r = await p.goto(BASE + url);
    const owner = await p.locator("[data-testid=legal-owner] dt").allTextContents();
    t.check(`${url}: works, no owner/email/city lines, no date`, r.status() === 200 && owner.join() === "Formulario" && (await p.getByTestId("legal-date").count()) === 0, owner.join());
  }
  await c.close();
  // the reader, signed in
  const s = await context(browser, { w: 1440, h: 900, touch: false });
  const lr = await s.request.post(BASE + "/api/me/login", { data: { username, password: PW }, headers: { Origin: BASE } });
  const sp = await s.newPage(); sp.on("pageerror", (e) => errors.push(String(e)));
  await sp.goto(`${BASE}/b/${pub.slug}#leer`);
  t.check("signed in, the reader opens", lr.status() === 200 && !!(await sp.waitForSelector("header[role=toolbar]", { timeout: 30000 }).catch(() => null)));
  await s.close();
}
{
  const c = await adminContext(browser, { w: 1440, h: 900 }); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(BASE + "/admin"); await p.waitForSelector("[role=tab]"); await sleep(800);
  t.check("admin: no unread badge", (await p.getByTestId("unread-badge").count()) === 0);
  await p.getByRole("tab", { name: "Mensajes" }).click();
  t.check("Mensajes: «Actualiza la base de datos en Mantenimiento.»", (await p.getByTestId("messages-missing").innerText({ timeout: 10000 })) === "Actualiza la base de datos en Mantenimiento.");
  await p.getByRole("tab", { name: "Ajustes legales" }).click();
  t.check("Ajustes legales: «Actualiza la base de datos en Mantenimiento.»", (await p.getByTestId("legal-missing").innerText({ timeout: 10000 })) === "Actualiza la base de datos en Mantenimiento.");
  // Actualizar base de datos: both tabs appear, and the sections work at once
  await p.getByRole("tab", { name: "Mantenimiento" }).click();
  await p.getByRole("button", { name: "Actualizar base de datos" }).click();
  await p.waitForSelector("[data-testid=maintenance-result]", { timeout: 20000 });
  const res = await p.getByTestId("maintenance-result").innerText();
  t.check("Actualizar base de datos creates messages and settings", res.includes("messages") && res.includes("settings"), res);
  await p.getByRole("tab", { name: "Ajustes legales" }).click(); await p.waitForSelector("[data-testid=legal-panel]", { timeout: 10000 });
  await p.fill("#legal-owner", "Titular de prueba"); await p.fill("#legal-email", "titular@example.com");
  await p.getByRole("button", { name: "Guardar" }).click(); await sleep(900);
  t.check("Ajustes legales works right after", (await api("/api/admin/settings")).json?.legal?.owner === "Titular de prueba");
  await p.getByRole("tab", { name: "Mensajes" }).click();
  t.check("Mensajes works right after", !!(await p.waitForSelector("[data-testid=messages-panel]", { timeout: 10000 }).catch(() => null)));
  await c.close();
  const v = await context(browser, { w: 390, h: 844 }); const vp = await v.newPage();
  await vp.goto(BASE + "/contacto");
  t.check("/contacto shows the form right after", !!(await vp.waitForSelector("[data-testid=contact-form]", { timeout: 10000 }).catch(() => null)));
  await vp.goto(BASE + "/aviso-legal");
  t.check("the legal pages show the details right after", (await vp.locator("[data-testid=legal-owner]").innerText()).includes("Titular de prueba"));
  await v.close();
}
await browser.close();
t.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
t.done();
