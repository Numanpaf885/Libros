// Permanent test: button states (hover, pressed, focus-visible, loading, disabled, touch, reduced motion).
import { launch, setup, context, counter, BASE, sleep, warm, SHOTS } from "./lib.mjs";
const t = counter("buttons");
const { b1 } = await setup();
await warm(["/", "/entrar", `/b/${b1.slug}`]);
const b = await launch();
const css = (p, sel, prop, pseudo) => p.evaluate(([sel, prop, pseudo]) => getComputedStyle(document.querySelector(sel), pseudo || null)[prop], [sel, prop, pseudo]);
const matrix = (m) => { if (!m || m === "none") return { sx: 1, ty: 0, tx: 0 }; const v = m.match(/matrix\(([^)]+)\)/)[1].split(",").map(Number); return { sx: v[0], ty: v[5], tx: v[4] }; };
const PRIMARY = "main a.btn-primary";
const ICON = "button[aria-label^='Cambiar a tema']";
const shotEl = async (p, sel, name) => { const bb = await p.locator(sel).first().boundingBox(); await p.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: Math.max(0, bb.x - 14), y: Math.max(0, bb.y - 14), width: bb.width + 28, height: bb.height + 28 } }); };

for (const dark of [false, true]) {
  const th = dark ? "oscuro" : "claro";
  const c = await context(b, { w: 1440, h: 900, touch: false, dark, signedIn: false, books: [] }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector(PRIMARY); await sleep(900);
  for (const [kind, sel] of [["primario", PRIMARY], ["icono", ICON]]) {
    const q = p.locator(sel).first();
    await p.mouse.move(5, 500); await sleep(350);
    await shotEl(p, sel, `31-boton-${kind}-reposo-${th}`);
    const bb = await q.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(400);
    if (kind === "primario") {
      const m = matrix(await css(p, sel, "transform"));
      t.check(`${th} primary hover: lifts 1px (ty=${m.ty}) with a shadow`, Math.abs(m.ty + 1) < 0.2 && (await css(p, sel, "boxShadow")) !== "none");
      const arrow = matrix(await p.evaluate((s) => getComputedStyle(document.querySelector(s + " .nudge")).transform, sel));
      t.check(`${th} primary hover: arrow nudges right (tx=${arrow.tx.toFixed(1)}px)`, arrow.tx >= 2 && arrow.tx <= 3.5);
    } else {
      const o = Number(await css(p, sel, "opacity", "::before"));
      t.check(`${th} icon hover: round background fades in (opacity ${o})`, o > 0.05);
      const bg = await css(p, sel, "borderRadius"); t.check(`${th} icon button is round (${bg})`, parseFloat(bg) >= 20);
    }
    await shotEl(p, sel, `31-boton-${kind}-hover-${th}`);
    await p.mouse.down(); await sleep(250);
    const mp = matrix(await css(p, sel, "transform"));
    t.check(`${th} ${kind} pressed: scale(0.97) (${mp.sx.toFixed(3)})`, Math.abs(mp.sx - 0.97) < 0.01);
    await shotEl(p, sel, `31-boton-${kind}-pulsado-${th}`);
    await p.mouse.move(5, 500); await p.mouse.up(); await sleep(500);
    const mr = matrix(await css(p, sel, "transform")); t.check(`${th} ${kind} released: back to normal (${mr.sx.toFixed(3)})`, Math.abs(mr.sx - 1) < 0.005 && Math.abs(mr.ty) < 0.1);
  }
  // focus-visible: keyboard only
  await p.mouse.click(5, 500); await p.keyboard.press("Tab");
  for (let i = 0; i < 12; i++) { const hit = await p.evaluate((sel) => document.activeElement?.matches(sel), PRIMARY); if (hit) break; await p.keyboard.press("Tab"); }
  await sleep(350);
  t.check(`${th} primary focus-visible by keyboard: accent ring`, (await css(p, PRIMARY, "outlineStyle")) === "solid" && (await css(p, PRIMARY, "outlineWidth")) === "2px");
  await shotEl(p, PRIMARY, `31-boton-primario-foco-${th}`);
  await p.locator(ICON).first().focus(); await sleep(350); await shotEl(p, ICON, `31-boton-icono-foco-${th}`);
  t.check(`${th} icon focus-visible by keyboard: ring`, (await css(p, ICON, "outlineStyle")) === "solid");
  await p.mouse.click(5, 500);
  await p.locator(ICON).first().click(); await sleep(300);
  t.check(`${th} clicking with the mouse shows no focus ring`, !(await p.evaluate(() => document.activeElement?.matches(":focus-visible"))));
  await c.close();
}
// links: underline grows from the left; disabled and loading buttons do nothing on hover; spinner keeps the width
{
  const c = await context(b, { w: 1440, h: 900, touch: false, signedIn: false }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector("footer .link, footer a"); await sleep(700);
  const sel = "header nav .ulink"; const q = p.locator(sel).first(); const bb = await q.boundingBox();
  const s0 = await css(p, sel, "backgroundSize"); await p.mouse.move(bb.x + 8, bb.y + 8); await sleep(400); const s1 = await css(p, sel, "backgroundSize");
  t.check(`text link: underline grows on hover ("${s0.split(",")[0]}" -> "${s1.split(",")[0]}")`, s0.startsWith("0px") && !s1.startsWith("0px"));
  await p.goto(BASE + "/entrar"); await p.waitForSelector("button.btn-primary"); await sleep(600);
  const w0 = (await p.locator("button.btn-primary").boundingBox()).width;
  await p.evaluate(() => { const e = document.querySelector("button.btn-primary"); e.setAttribute("aria-busy", "true"); e.disabled = true; }); await sleep(300);
  const w1 = (await p.locator("button.btn-primary").boundingBox()).width;
  t.check(`loading: width unchanged (${w0} -> ${w1}), spinner shown, label hidden`, w0 === w1 && (await css(p, "button.btn-primary", "animationName", "::after")) === "spin" && (await css(p, "button.btn-primary", "color")) === "rgba(0, 0, 0, 0)");
  const bb2 = await p.locator("button.btn-primary").boundingBox(); await p.mouse.move(bb2.x + 10, bb2.y + 10); await sleep(350);
  t.check("loading/disabled button: no hover lift", matrix(await css(p, "button.btn-primary", "transform")).ty === 0);
  t.check("disabled button: cursor not-allowed", (await css(p, "button.btn-primary", "cursor")) === "progress" || (await css(p, "button.btn-primary", "cursor")) === "not-allowed");
  await p.evaluate(() => { const e = document.querySelector("button.btn-primary"); e.removeAttribute("aria-busy"); e.disabled = true; }); await sleep(300);
  await p.mouse.move(bb2.x + 12, bb2.y + 12); await sleep(300);
  t.check("disabled (not loading): cursor not-allowed, no lift, dimmed", (await css(p, "button.btn-primary", "cursor")) === "not-allowed" && matrix(await css(p, "button.btn-primary", "transform")).ty === 0 && Number(await css(p, "button.btn-primary", "opacity")) < 0.6);
  await c.close();
}
// touch screen: nothing stays in the hover state after a tap
{
  const c = await context(b, { w: 390, h: 800, touch: true, signedIn: false }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector(PRIMARY); await sleep(700);
  t.check("touch device: (hover: hover) is false", !(await p.evaluate(() => matchMedia("(hover: hover)").matches)));
  const r = await p.locator(ICON).first().boundingBox(); await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await sleep(600);
  const m = matrix(await css(p, ICON, "transform")); const o = Number(await css(p, ICON, "opacity", "::before"));
  t.check(`touch: after a tap the icon button is not stuck pressed or hovered (scale=${m.sx}, hover bg opacity=${o})`, m.sx === 1 && o === 0);
  await c.close();
}
// reduced motion: only colour changes
{
  const c = await context(b, { w: 1440, h: 900, touch: false, reduced: true, signedIn: false }); const p = await c.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector(PRIMARY); await sleep(700);
  const bb = await p.locator(PRIMARY).boundingBox(); await p.mouse.move(bb.x + 20, bb.y + 10); await sleep(400);
  t.check("reduced motion: hover applies no transform", (await css(p, PRIMARY, "transform")) === "none" && (await css(p, PRIMARY, "boxShadow")) === "none");
  t.check("reduced motion: the colour still changes on hover", (await css(p, PRIMARY, "backgroundColor")) !== "rgb(30, 58, 95)");
  t.check("reduced motion: arrow does not move", (await p.evaluate((s) => getComputedStyle(document.querySelector(s + " .nudge")).transform, PRIMARY)) === "none");
  await p.mouse.down(); await sleep(250); t.check("reduced motion: pressed applies no scale", (await css(p, PRIMARY, "transform")) === "none"); await p.mouse.move(5, 500); await p.mouse.up();
  const ic = p.locator(ICON).first(); const ib = await ic.boundingBox(); await p.mouse.move(ib.x + 10, ib.y + 10); await p.mouse.down(); await sleep(250);
  t.check("reduced motion: icon button pressed applies no scale", (await css(p, ICON, "transform")) === "none"); await p.mouse.up();
  await c.close();
}
await b.close();
t.done();
