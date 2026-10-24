// Permanent test: every clickable thing shows the hand cursor (not-allowed when disabled), and no div/span has an onClick.
import fs from "node:fs";
import path from "node:path";
import { launch, setup, context, adminContext, counter, BASE, sleep, warm } from "./lib.mjs";
const t = counter("cursor");

// ---- 1. source scan: onClick only on real buttons / links / inputs / components -------------------------------------
const bad = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(d, e.name))) : e.name.endsWith(".tsx") ? [path.join(d, e.name)] : []);
for (const f of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(f, "utf8");
  const re = /<(div|span|li|ul|p|section|article|img|svg|h[1-6]|header|footer|nav|main|aside|td|tr)\b/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, q = "";
    for (; i < src.length; i++) { const ch = src[i]; if (q) { if (ch === q && src[i - 1] !== "\\") q = ""; continue; } if (ch === '"' || ch === "'" || ch === "`") q = ch; else if (ch === "{") depth++; else if (ch === "}") depth--; else if (ch === ">" && depth === 0 && src[i - 1] !== "=") break; }
    if (/\sonClick\s*=/.test(src.slice(m.index, i))) bad.push(`${f}:${src.slice(0, m.index).split("\n").length} <${m[1]}>`);
  }
}
t.check(`no div/span/li/... with onClick in app/ and components/ (${bad.length})`, bad.length === 0, bad.join(", "));

// ---- 2. computed cursor in the browser ------------------------------------------------------------------------------
const { b1, b2, code } = await setup();
await warm(["/", `/b/${b1.slug}`, "/entrar", "/activar", "/cuenta", "/admin", "/admin/login", "/contacto", "/privacidad", "/cookies", "/aviso-legal"]);
const b = await launch();
let checked = 0; const failures = [];
const SEL = [
  "a[href]", "button", "summary", "select", "[role=button]", "[role=tab]", "[role=menuitem]", "[role=switch]", "[role=option]", "[role=radio]", "[role=checkbox]", "[role=link]",
  "input[type=checkbox]", "input[type=radio]", "input[type=file]", "input[type=range]", "input[type=submit]", "label[for]",
  "label:has(input[type=checkbox])", "label:has(input[type=radio])", "label:has(input[type=file])", "[data-clickable]", "[onclick]",
].join(",");
async function scan(p, name) {
  const r = await p.evaluate((SEL) => {
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el); const dis = el.matches(":disabled, [aria-disabled=true]") || !!el.closest("fieldset:disabled") || (el.tagName === "LABEL" && !!el.control?.disabled) || (el.tagName === "LABEL" && !!el.querySelector("input:disabled"));
      if (el.getAttribute("aria-busy") === "true") continue;
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), txt: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24), cur: cs.cursor, dis });
    }
    // text inputs keep the text cursor
    const txt = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=submit]):not([type=button]):not([type=hidden]), textarea")].filter((e) => !e.disabled).map((e) => getComputedStyle(e).cursor);
    return { out, txt };
  }, SEL);
  let n = 0;
  for (const e of r.out) { n++; const want = e.dis ? "not-allowed" : "pointer"; if (e.cur !== want) failures.push(`${name}: <${e.tag} class="${e.cls}"> "${e.txt}" cursor=${e.cur} (want ${want})`); }
  for (const c of r.txt) { n++; if (c !== "text") failures.push(`${name}: text input cursor=${c}`); }
  checked += n;
  return n;
}
const sc = async (p, name) => { const n = await scan(p, name); console.log(`   ${name}: ${n} elements`); };
for (const [w, touch] of [[1440, false], [390, true]]) {
  for (const signed of [false, true]) {
    const tag = `${w}px ${signed ? "in" : "out"}`;
    const c = await context(b, { w, h: 900, touch, signedIn: signed, books: [b1.slug, b2.slug] }); const p = await c.newPage();
    await p.goto(BASE + "/"); await sleep(1200); await sc(p, `${tag} /`);
    if (signed) { await p.locator("button[aria-haspopup=menu]").first().click(); await sleep(300); await sc(p, `${tag} / (account menu open)`); }
    if (touch) { await p.locator("button[aria-label='Abrir menú']").click(); await sleep(700); await sc(p, `${tag} / (menu sheet open)`); await p.keyboard.press("Escape"); await sleep(500); }
    await p.goto(BASE + `/b/${b1.slug}`); await sleep(1200); await sc(p, `${tag} /b/[slug]`);
    if (signed) await p.goto(BASE + `/b/${b1.slug}#p=2`); else await p.goto(BASE + `/b/${b1.slug}?code=${code}#p=2`);
    await p.waitForSelector("[data-unit], [data-page], button:has-text('Leer'), button:has-text('Continuar en la página')", { timeout: 30000 }).catch(() => {}); await sleep(800);
    if (!(await p.locator("[data-unit]").count())) { await p.locator("button:has-text('Continuar en la página'), button:has-text('Leer')").first().click().catch(() => {}); await p.waitForSelector("[data-unit]", { timeout: 30000 }).catch(() => {}); }
    await sleep(2500);
    await sc(p, `${tag} reader (book)`);
    const stage = await p.evaluate(() => { const e = document.querySelector("[data-unit]")?.closest("[data-renders]"); return e ? getComputedStyle(e).cursor : "none"; });
    t.check(`${tag} reader: book page shows a grab cursor (${stage})`, stage === "grab");
    if (!touch) {
      await p.locator("[data-testid=bookmarks-open]").click().catch(() => {}); await sleep(500); await sc(p, `${tag} reader (bookmarks panel)`);
      await p.locator("button[aria-label='Efecto de página']").first().click().catch(() => {}); await sleep(300); await sc(p, `${tag} reader (effect menu)`);
      await p.locator("[role=radio]:has-text('PDF')").click().catch(() => {}); await sleep(1500); await sc(p, `${tag} reader (pdf)`);
    }
    for (const u of ["/entrar", "/activar", "/contacto", "/privacidad", "/cookies", "/aviso-legal"]) { await p.goto(BASE + u); await sleep(900); await sc(p, `${tag} ${u}`); }
    if (signed) { await p.goto(BASE + "/cuenta"); await sleep(1200); await sc(p, `${tag} /cuenta`); }
    await c.close();
  }
  // the cookie notice (first visit)
  const n = await context(b, { w, h: 900, touch, notice: true }); const np = await n.newPage();
  await np.goto(BASE + "/"); await np.waitForSelector("[data-testid=cookie-notice]"); await sc(np, `${w}px cookie notice`); await n.close();
}
{
  const c = await adminContext(b, { w: 1440, h: 900, touch: false }); const p = await c.newPage();
  const lc = await context(b, { w: 1440, h: 900, touch: false }); const lp = await lc.newPage(); await lp.goto(BASE + "/admin/login"); await sleep(800); await sc(lp, "/admin/login"); await lc.close();
  await p.goto(BASE + "/admin"); await p.waitForSelector("[role=tab]"); await sleep(900); await sc(p, "/admin (Libros)");
  const rows = await p.locator("main li button, main summary, main [aria-expanded]").all();
  if (rows.length) { await rows[0].click().catch(() => {}); await sleep(700); await sc(p, "/admin (Libros, a book open)"); }
  await p.locator("[role=tab]:has-text('Usuarios')").click(); await sleep(900); await sc(p, "/admin (Usuarios)");
  const more = await p.locator("main li button, main summary").all(); if (more.length) { await more[0].click().catch(() => {}); await sleep(600); await sc(p, "/admin (Usuarios, one open)"); }
  await p.locator("[role=tab]:has-text('Mensajes')").click(); await sleep(900); await sc(p, "/admin (Mensajes)");
  const msg = p.locator("[data-testid=messages-list] li > button").first();
  if (await msg.count()) { await msg.click(); await sleep(700); await sc(p, "/admin (Mensajes, one open)"); }
  await p.locator("[role=tab]:has-text('Ajustes legales')").click(); await sleep(900); await sc(p, "/admin (Ajustes legales)");
  await c.close();
}
await b.close();
t.check(`${checked} interactive elements checked, ${failures.length} failures`, failures.length === 0, "\n    " + [...new Set(failures)].slice(0, 25).join("\n    "));
console.log(`\nCURSOR COUNT: ${checked} elements checked, ${failures.length} failures`);
t.done();
