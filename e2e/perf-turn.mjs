// Page-turn smoothness in Book mode (mock mode): frames per second while a page turns, measured with requestAnimationFrame
// over many turns, on a spread (1440 px) and on a phone (390 px). The book is the generated Spanish PDF (uploaded once).
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/perf-turn.mjs   (TURNS=16, RUNS=3, TITLE=... to change)
import { BASE, adminApi, launch, sleep } from "./lib.mjs";
import { makeSpanishPdf, uploadPdf } from "./text-lib.mjs";

const TITLE = process.env.TITLE || "Texto de prueba (rendimiento)";
const TURNS = Number(process.env.TURNS || 16);
const RUNS = Number(process.env.RUNS || 3);
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const browser = await launch();

let book = (await api("/api/admin/books")).json.books.find((b) => b.title === TITLE && b.status === "published");
if (!book) book = await uploadPdf(browser, { title: TITLE, bytes: (await makeSpanishPdf()).bytes });
const code = (await api(`/api/admin/books/${book.id}/codes`, "POST", { count: 1, label: "perf" })).json.codes[0];
const plain = typeof code === "string" ? code : code.code ?? code.plain;

async function measure({ w, h, touch }) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  await c.addInitScript(() => { try { localStorage.setItem("br:mode", "book"); localStorage.setItem("br:effect", "turn"); localStorage.setItem("theme", "light"); } catch { /* ignore */ } });
  const p = await c.newPage();
  await p.goto(`${BASE}/b/${book.slug}?code=${plain}#p=1`);
  await p.waitForSelector("[data-unit]", { timeout: 30000 });
  await sleep(4500); // opening animation + preloading
  await p.evaluate(() => {
    const w = window;
    w.__f = [];
    const loop = (t) => { w.__f.push([t, document.getAnimations().some((a) => a.playState === "running") ? 1 : 0]); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  // back and forth, so that every key press really turns a page (the book has only a few pages)
  const units = w >= 1024 && w > h ? Math.floor(book.page_count / 2) + 1 : book.page_count;
  for (let i = 0, at = 0, dir = 1; i < TURNS; i++) {
    if (at + dir < 0 || at + dir >= units) dir = -dir;
    await p.keyboard.press(dir > 0 ? "ArrowRight" : "ArrowLeft");
    at += dir;
    await sleep(1100);
  }
  const frames = await p.evaluate(() => window.__f);
  const renders = await p.locator("[data-renders]").first().getAttribute("data-renders");
  await c.close();
  const d = [];
  for (let i = 1; i < frames.length; i++) if (frames[i][1] && frames[i - 1][1]) d.push(frames[i][0] - frames[i - 1][0]);
  d.sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  return { fps: 1000 / mean, p95: d[Math.floor(d.length * 0.95)] ?? 0, long: d.filter((x) => x > 25).length, frames: d.length, renders };
}

const out = {};
for (const [name, v] of [["1440 (spread)", { w: 1440, h: 900, touch: false }], ["390 (phone)", { w: 390, h: 844, touch: true }]]) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) runs.push(await measure(v));
  const fps = runs.reduce((a, b) => a + b.fps, 0) / runs.length;
  out[name] = { fps: Number(fps.toFixed(1)), runs: runs.map((x) => Number(x.fps.toFixed(1))), p95ms: Math.max(...runs.map((x) => x.p95)).toFixed(1), longFrames: runs.reduce((a, b) => a + b.long, 0), framesMeasured: runs.reduce((a, b) => a + b.frames, 0) };
  console.log(`${name}: ${out[name].fps} fps (runs ${out[name].runs.join(", ")}), p95 frame ${out[name].p95ms} ms, frames > 25 ms: ${out[name].longFrames} of ${out[name].framesMeasured}`);
}
console.log(JSON.stringify({ book: book.slug, turns: TURNS, runs: RUNS, ...out }));
await browser.close();
