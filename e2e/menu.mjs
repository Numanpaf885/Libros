// Permanent test: the phone menu is a bottom sheet that never moves the page and never goes off screen.
import { launch, setup, context, counter, BASE, sleep, warm } from "./lib.mjs";
const t = counter("menu");
const { b1, b2 } = await setup();
await warm(["/", `/b/${b1.slug}`]);
const b = await launch();
// A real finger: tap at the element's centre, with no automatic scrolling (Playwright's own tap() scrolls the element into view first).
const tap = async (p, loc) => { const r = await loc.boundingBox(); await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); };
const state = (p) => p.evaluate(() => {
  const d = document.querySelector("[role=dialog]"); const r = d?.getBoundingClientRect();
  return { y: window.scrollY, dlg: !!d, box: r ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null, cw: document.documentElement.clientWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, active: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.slice(0, 20) };
});
for (const w of [360, 390]) for (const signed of [false, true]) {
  const tag = `${w}px ${signed ? "signed in" : "signed out"}`;
  console.log(`\n== ${tag}`);
  const c = await context(b, { w, h: 780, signedIn: signed, books: [b1.slug, b2.slug] }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector("button[aria-label='Abrir menú']"); await sleep(1200);
  const burger = p.locator("button[aria-label='Abrir menú']");
  for (const startY of [0, 700]) {
    await p.evaluate((y) => window.scrollTo(0, y), startY); await sleep(400);
    const before = await state(p);
    await tap(p, burger); await sleep(900);
    const open = await state(p);
    t.check(`${tag} from y=${startY}: sheet opens`, open.dlg);
    t.check(`${tag} from y=${startY}: scrollY unchanged while open (${before.y} -> ${open.y})`, Math.abs(open.y - before.y) <= 1);
    t.check(`${tag} from y=${startY}: sheet fully inside the viewport (l=${open.box?.l} r=${open.box?.r} of ${open.cw}, b=${open.box?.b} of ${open.ih})`, !!open.box && open.box.l >= 0 && open.box.r <= open.cw && open.box.b <= open.ih + 1 && open.box.t >= 0);
    t.check(`${tag} from y=${startY}: page not wider than the screen while open`, open.sw <= open.cw);
    const items = await p.locator("[role=dialog] a, [role=dialog] button").allTextContents();
    const need = ["Catálogo", "Cómo funciona", "Contacto", signed ? "Mi cuenta" : "Entrar", ...(signed ? ["Salir"] : [])];
    t.check(`${tag}: menu items ${need.join(", ")} + theme`, need.every((n) => items.some((x) => x.trim() === n)) && (await p.locator("[role=dialog] button[aria-label^='Cambiar a tema']").count()) === 1, items.join("|"));
    // focus is trapped: a few Tabs stay inside the dialog
    for (let i = 0; i < 9; i++) await p.keyboard.press("Tab");
    t.check(`${tag}: focus stays inside the sheet while open`, await p.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
    // 1. Escape
    await p.keyboard.press("Escape"); await sleep(700);
    let after = await state(p);
    t.check(`${tag} y=${startY}: Esc closes, scrollY (${after.y}) = ${before.y}`, !after.dlg && Math.abs(after.y - before.y) <= 1);
    t.check(`${tag} y=${startY}: focus returns to the ☰ button`, after.active === "Abrir menú", String(after.active));
    // 2. backdrop
    await tap(p, burger); await sleep(800); await p.touchscreen.tap(w / 2, 40); await sleep(700);
    after = await state(p); t.check(`${tag} y=${startY}: backdrop tap closes, scrollY ok`, !after.dlg && Math.abs(after.y - before.y) <= 1);
    // 3. close button inside the sheet
    await tap(p, burger); await sleep(800); await tap(p, p.locator("[role=dialog] [data-sheet-close]")); await sleep(700);
    after = await state(p); t.check(`${tag} y=${startY}: ✕ closes, scrollY ok`, !after.dlg && Math.abs(after.y - before.y) <= 1);
    // 4. swipe down on the handle
    await tap(p, burger); await sleep(800);
    const hb = await p.locator("[role=dialog] .touch-none").first().boundingBox();
    await p.mouse.move(hb.x + hb.width / 2, hb.y + 10); await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(hb.x + hb.width / 2, hb.y + 10 + i * 25); await sleep(16); }
    await p.mouse.up(); await sleep(800);
    after = await state(p); t.check(`${tag} y=${startY}: swipe down closes, scrollY ok`, !after.dlg && Math.abs(after.y - before.y) <= 1);
  }
  // section links: close first, then smooth scroll with the header offset
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  await tap(p, burger); await sleep(800);
  await tap(p, p.locator("[role=dialog] a:has-text('Catálogo')"));
  await sleep(120);
  const mid = await state(p); t.check(`${tag}: section link closes the sheet before scrolling`, !mid.dlg || mid.y < 50);
  await sleep(1800);
  const end = await p.evaluate(() => { const e = document.getElementById("catalogo"); const h = document.querySelector("header.site-header .glass-float").getBoundingClientRect(); return { y: scrollY, top: e.getBoundingClientRect().top, hb: h.bottom, dlg: !!document.querySelector("[role=dialog]") }; });
  t.check(`${tag}: scrolled to Catálogo (y=${Math.round(end.y)}), section top ${Math.round(end.top)}px is below the floating header (${Math.round(end.hb)}px)`, !end.dlg && end.y > 200 && end.top >= end.hb - 1 && end.top < end.hb + 90);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  if (signed) { await tap(p, burger); await sleep(700); await tap(p, p.locator("[role=dialog] button:has-text('Salir')")); await sleep(1200); t.check(`${tag}: Salir signs out and closes`, (await p.locator("[role=dialog]").count()) === 0 && (await p.locator("a:has-text('Entrar')").count()) > 0); }
  await c.close();
}
// from a book page the section links navigate to the home page section
{
  const c = await context(b, { w: 360, h: 780, signedIn: false }); const p = await c.newPage();
  await p.goto(BASE + `/b/${b1.slug}`); await sleep(1200);
  await tap(p, p.locator("button[aria-label='Abrir menú']")); await sleep(700); await tap(p, p.locator("[role=dialog] a:has-text('Contacto')")); await sleep(2500);
  t.check("from a book page, Contacto goes to the home page section", new URL(p.url()).pathname === "/" && p.url().includes("#contacto"), p.url());
  await c.close();
}
await b.close();
t.done();
