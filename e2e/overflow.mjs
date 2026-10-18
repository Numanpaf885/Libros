// Permanent test: no page may be wider than the screen (the overflow-x safety net is switched off).
import { launch, setup, context, adminContext, counter, BASE, sleep, warm } from "./lib.mjs";
const t = counter("overflow");
const { b1, b2, code } = await setup();
await warm(["/", `/b/${b1.slug}`, "/entrar", "/activar", "/cuenta", "/admin", "/admin/login"]);
const b = await launch();
const WIDTHS = [320, 360, 375, 390, 414, 768];
const rows = [];
const measure = async (p) => p.evaluate(() => {
  const de = document.documentElement; const sw = Math.max(de.scrollWidth, document.body.scrollWidth); const iw = de.clientWidth;
  let worst = null;
  for (const e of document.querySelectorAll("body *")) { const r = e.getBoundingClientRect(); if (r.right > iw + 1 && r.width > 0 && !e.closest("[data-allow-overflow]") && getComputedStyle(e).position !== "fixed") { worst = `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} right=${Math.round(r.right)}`; break; } }
  return { sw, iw, worst };
});
for (const w of WIDTHS) {
  for (const signed of [false, true]) {
    const c = await context(b, { w, h: 800, signedIn: signed, books: [b1.slug, b2.slug] });
    const p = await c.newPage();
    const pages = [["/", "/"], [`/b/${b1.slug}`, "book page"], [`/b/${b1.slug}?code=${code}#p=2`, "reader"], ["/entrar", "/entrar"], ["/activar", "/activar"]];
    if (signed) pages.push(["/cuenta", "/cuenta"]);
    for (const [url, name] of pages) {
      await p.goto(BASE + url); await p.waitForLoadState("load"); await sleep(url.includes("code=") ? 2500 : 900);
      const m = await measure(p);
      rows.push({ w, signed, name, ...m });
      t.check(`${w}px ${signed ? "signed in " : "signed out"} ${name}: scrollWidth ${m.sw} <= ${m.iw}`, m.sw <= m.iw, m.worst || "");
    }
    await c.close();
  }
  const a = await adminContext(b, { w, h: 800 }); const p = await a.newPage();
  await p.goto(BASE + "/admin/login"); await sleep(600);
  let m = await measure(p); t.check(`${w}px /admin/login: scrollWidth ${m.sw} <= ${m.iw}`, m.sw <= m.iw, m.worst || "");
  await p.goto(BASE + "/admin"); await p.waitForSelector("[role=tab]"); await sleep(700);
  for (const tab of await p.locator("[role=tab]").all()) { const n = (await tab.textContent()).trim(); await tab.click(); await sleep(500); m = await measure(p); t.check(`${w}px /admin tab "${n}": scrollWidth ${m.sw} <= ${m.iw}`, m.sw <= m.iw, m.worst || ""); }
  await a.close();
}
// the long titles
{
  const c = await context(b, { w: 360, h: 800, signedIn: true, books: [b1.slug, b2.slug] }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector("#continuar"); await sleep(600);
  const cards = await p.evaluate(() => [...document.querySelectorAll("#continuar ~ ul li a")].map((a) => {
    const h = a.querySelector("h3"), bar = a.querySelector("[role=progressbar]"), ar = a.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(h).lineHeight); const br = bar.getBoundingClientRect(), col = bar.parentElement.getBoundingClientRect();
    return { title: h.textContent, lines: Math.round(h.getBoundingClientRect().height / lh), barInCard: br.right <= ar.right + 0.5 && br.width <= col.width + 0.5 };
  }));
  t.check(`two cards in "Continuar leyendo" (${cards.length})`, cards.length === 2);
  for (const k of cards) { t.check(`"${k.title}" wraps to at most 2 lines (${k.lines})`, k.lines <= 2); t.check(`progress bar stays inside its card`, k.barInCard); }
  await c.close();
}
await b.close();
console.log("\nwidth  signed  page  scrollWidth/innerWidth (worst offender if any)");
for (const r of rows.filter((r) => r.sw > r.iw)) console.log(r.w, r.signed, r.name, `${r.sw}/${r.iw}`, r.worst);
t.done();
