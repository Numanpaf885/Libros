// Chapters on a Sheet whose `books` tab has no `chapters` column yet (before "Actualizar base de datos"), then after it.
//   MOCK_MISSING_COLUMNS=chapters DATA_BACKEND=mock npx next dev -p 3100
//   node e2e/chapters-missing.mjs
// The mock keeps the simulated header row in memory: restart the server to run this again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, adminApi, adminContext, counter, launch, sleep } from "./lib.mjs";
import { CHAPTERS, makeChaptersPdf, uploadPdf } from "./text-lib.mjs";

const t = counter("chapters-missing");
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const books = (await api("/api/admin/maintenance")).json?.tabs?.find((x) => x.tab === "books");
if (!books?.missing.includes("chapters")) { console.log("Start the server with MOCK_MISSING_COLUMNS=chapters (and restart it to repeat)."); process.exit(1); }
const browser = await launch();
const errors = [];
const stamp = Date.now().toString(36);
const bytes = await makeChaptersPdf();
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "libros-ch-")), "capitulos.pdf");
fs.writeFileSync(file, bytes);

const B = await uploadPdf(browser, { title: `Sin columna capítulos ${stamp}`, bytes });
const list = (await api("/api/admin/books")).json;
t.check("without the column: the admin knows (chapters: false)", list.chapters === false);
t.check("upload works and stores no chapters", (list.books.find((b) => b.id === B.id)?.chapters ?? "") === "");
const put = await api(`/api/admin/books/${B.id}/chapters`, "PUT", { chapters: CHAPTERS });
t.check("saving chapters: 409 «Actualiza la base de datos en Mantenimiento.»", put.status === 409 && put.json?.error === "Actualiza la base de datos en Mantenimiento.");
const code = (await api(`/api/admin/books/${B.id}/codes`, "POST", { count: 1, label: "x" })).json.codes[0];
const plain = typeof code === "string" ? code : code.code ?? code.plain;
const cookie = (await fetch(`${BASE}/api/books/${B.slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code: plain }) })).headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
const meta = async () => (await fetch(`${BASE}/api/books/${B.slug}/meta`, { headers: { cookie } })).json();
const m0 = await meta();
t.check("readers get no chapters, and search still works", Array.isArray(m0.chapters) && m0.chapters.length === 0 && m0.search === true);
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript(() => { try { localStorage.setItem("br:mode", "pdf"); localStorage.setItem("br:cookies", "1"); } catch { /* ignore */ } });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${BASE}/b/${B.slug}?code=${plain}#p=1`);
  await p.waitForSelector("[data-page]", { timeout: 30000 }); await sleep(1500);
  t.check("reader: no «Capítulos» button, «Buscar» is there", (await p.getByTestId("chapters-open").count()) === 0 && (await p.getByTestId("search-open").count()) >= 1);
  await c.close();
}
{
  const c = await adminContext(browser, { w: 1440, h: 900, touch: false });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${B.title}`); await sleep(600);
  let row = p.locator("li[role=row]", { hasText: B.title });
  await row.getByRole("button", { name: "Capítulos", exact: true }).click();
  t.check("admin «Capítulos»: asks to update the database", (await row.getByTestId("chapters-panel").innerText()).includes("Actualizar base de datos"));
  await p.getByRole("tab", { name: "Mantenimiento" }).click();
  await p.getByRole("button", { name: "Actualizar base de datos" }).click();
  await p.waitForSelector("[data-testid=maintenance-result]", { timeout: 20000 });
  t.check("Actualizar base de datos adds books.chapters", (await p.getByTestId("maintenance-result").innerText()).includes("chapters"));
  await p.goto(BASE + "/admin"); await p.waitForSelector(`text=${B.title}`); await sleep(600);
  row = p.locator("li[role=row]", { hasText: B.title });
  await row.getByRole("button", { name: "Capítulos", exact: true }).click();
  await row.getByTestId("chapters-pdf").setInputFiles(file);
  await p.waitForSelector("[data-testid=chapters-note]");
  await row.getByRole("button", { name: "Guardar" }).click();
  await p.waitForSelector("text=Capítulos guardados");
  await c.close();
}
await sleep(500);
t.check("right after: chapters saved and readers get them", JSON.stringify((await meta()).chapters) === JSON.stringify(CHAPTERS));
t.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
t.done();
