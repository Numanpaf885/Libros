// Shared helpers for the browser tests in this folder.
// They run against a dev server started in MOCK mode:  DATA_BACKEND=mock npx next dev -p 3100
// and need Playwright:  npm i --no-save playwright-core  (and a Chromium: npx playwright-core install chromium)
// Never point them at the real site: they create and rename mock data.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BASE = process.env.BASE || "http://localhost:3100";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const PW = "Una frase larga 2026";
export const LONG1 = "Módulo 9. Factores humanos en el mantenimiento de aeronaves 2.ª edición";
export const LONG2 = "Módulo 8. Aerodinámica básica 2.ª edición";
export const SHOTS = process.env.SHOTS || path.join(process.cwd(), "screenshots");

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), ".cache/ms-playwright");
  try {
    for (const d of fs.readdirSync(root).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
      const p = path.join(root, d, "chrome-linux64/chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* fall back to Playwright's own lookup */ }
  return undefined;
}
export const launch = () => chromium.launch({ executablePath: chromePath() });

export function counter(name) {
  const r = { pass: 0, fail: 0, name };
  r.check = (label, cond, extra = "") => { if (cond) { r.pass++; console.log("  ok  ", label); } else { r.fail++; console.log("  FAIL", label, extra); } };
  r.done = () => { console.log(`\n${name}: ${r.pass} passed, ${r.fail} failed`); process.exit(r.fail ? 1 : 0); };
  return r;
}

/** Fetch helper with a cookie jar for the admin API. */
export function adminApi() {
  let cookie = "";
  return async (p, method = "GET", body) => {
    const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", cookie, Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.() ?? []; if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}

/** Mock data used by the tests: two published books with the long titles, a reader account with both, and a code. */
export async function setup() {
  const api = adminApi();
  await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
  const books = (await api("/api/admin/books")).json.books.filter((b) => b.status === "published");
  if (books.length < 2) throw new Error("need two published books in the mock data");
  const [b1, b2] = books;
  await api(`/api/admin/books/${b1.id}`, "PATCH", { title: LONG1 });
  await api(`/api/admin/books/${b2.id}`, "PATCH", { title: LONG2 });
  for (const u of (await api("/api/admin/users")).json.users) if (u.username === "e2e") await api(`/api/admin/users/${u.id}`, "DELETE", { username: "e2e" });
  const created = (await api("/api/admin/users", "POST", { username: "e2e", display_name: "Lucía Prueba con un nombre largo", books: [b1.id, b2.id] })).json;
  const act = await fetch(BASE + "/api/me/activate", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: "e2e", code: created.code, password: PW }) });
  const codeRes = (await api(`/api/admin/books/${b1.id}/codes`, "POST", { count: 1, label: "e2e" })).json;
  const c0 = codeRes.codes?.[0];
  return { api, b1, b2, code: typeof c0 === "string" ? c0 : c0?.code ?? c0?.plain, activateStatus: act.status };
}

// notice: show the cookie notice (by default it is dismissed, as for anyone who has already seen it).
export async function context(browser, { w, h, dark = false, reduced = false, touch = true, signedIn = false, noClip = true, saved = true, books = [], userAgent, notice = false }) {
  const c = await browser.newContext({
    viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", reducedMotion: reduced ? "reduce" : "no-preference",
    deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch && w < 800, ...(userAgent ? { userAgent } : {}),
  });
  await c.addInitScript(({ noClip, saved, books, dark, notice }) => {
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
      if (!notice) localStorage.setItem("br:cookies", "1");
      if (saved) for (const s of books) localStorage.setItem(`br:last:${s}`, "3");
      localStorage.setItem("br:mode", "book"); localStorage.setItem("br:effect", "none");
    } catch { /* ignore */ }
    if (noClip) { // switches the overflow-x safety net off, so a real overflow is not hidden
      const add = () => { const st = document.createElement("style"); st.textContent = "html, body, body > * { overflow-x: visible !important; }"; (document.head || document.documentElement).appendChild(st); };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
    }
  }, { noClip, saved, books, dark, notice });
  if (signedIn) {
    const r = await c.request.post(BASE + "/api/me/login", { data: { username: "e2e", password: PW }, headers: { Origin: BASE } });
    if (r.status() !== 200) throw new Error("e2e sign-in failed " + r.status());
  }
  return c;
}
export async function adminContext(browser, opts) {
  const c = await context(browser, { ...opts, signedIn: false });
  const r = await c.request.post(BASE + "/api/auth/login", { data: { username: "admin", password: "admin123" }, headers: { Origin: BASE } });
  if (r.status() !== 200) throw new Error("admin sign-in failed " + r.status());
  return c;
}
/** Visit every url once so Next compiles it before the browser tests start. */
export async function warm(urls, cookie = "") {
  for (const u of urls) await fetch(BASE + u, { headers: { cookie }, redirect: "manual" }).catch(() => {});
  await sleep(2000);
}
