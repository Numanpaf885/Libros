import { BASE, adminApi, launch } from "./lib.mjs";
import { makeChaptersPdf, uploadPdf } from "./text-lib.mjs";
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();
const book = await uploadPdf(browser, { title: `Capítulos ${Date.now().toString(36)}`, bytes: await makeChaptersPdf(), original: true });
await new Promise((r) => setTimeout(r, 1500));
const b = (await api("/api/admin/books")).json;
const me = b.books.find((x) => x.id === book.id);
console.log("flag chapters:", b.chapters, "stored:", me.chapters);
const c0 = (await api(`/api/admin/books/${book.id}/codes`, "POST", { count: 1, label: "s" })).json.codes[0];
const code = typeof c0 === "string" ? c0 : c0.code ?? c0.plain;
const un = await fetch(`${BASE}/api/books/${book.slug}/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ code }) });
const cookie = un.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const meta = await (await fetch(`${BASE}/api/books/${book.slug}/meta`, { headers: { cookie } })).json();
console.log("meta:", JSON.stringify({ chapters: meta.chapters, search: meta.search }));
for (const q of ["aerodinamica", "velocidad", "brújula", "zz"]) {
  const r = await fetch(`${BASE}/api/books/${book.slug}/search?q=${encodeURIComponent(q)}`, { headers: { cookie } });
  const j = await r.json();
  console.log(q, r.status, JSON.stringify(j).slice(0, 300));
}
console.log("no cookie:", (await fetch(`${BASE}/api/books/${book.slug}/search?q=viaje`)).status);
const info = await api(`/api/admin/books/${book.id}/download-info`);
console.log("admin download-info:", JSON.stringify(info.json));
await browser.close();
