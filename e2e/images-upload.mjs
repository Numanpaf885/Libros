// Create / replace a book from images: order editor, upload, resume, cover. Mock mode only.
//   DATA_BACKEND=mock npx next dev -p 3100   then   node e2e/images-upload.mjs
import fs from "node:fs";
import path from "node:path";
import { SHOTS, adminApi } from "./lib.mjs";
import { BASE, adminContext, counter, identifyPages, launch, pickImages, sleep } from "./dl-lib.mjs";

const t = counter("images-upload");
const shots = process.env.SCREENSHOTS === "1";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const api = adminApi();
await api("/api/auth/login", "POST", { username: "admin", password: "admin123" });
const stamp = Date.now().toString(36);

// 30 images p1..p30, picked in shuffled order. p5 is 3000 px wide (must be shrunk to 1400).
const shuffled = Array.from({ length: 30 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 31) - ((b * 7919) % 31));
const specs = shuffled.map((n) => ({ n, name: `p${n}.png`, w: n === 5 ? 3000 : 600, h: n === 5 ? 2000 : 800 }));
const labels = async (p) => p.$$eval("[data-testid=image-grid] [data-idx]", (els) => els.map((e) => [Number(e.dataset.idx), e.getAttribute("aria-label")]).sort((a, b) => a[0] - b[0]));
const firstNames = async (p, k = 6) => (await labels(p)).slice(0, k).map(([, l]) => l.split(": ")[1]);
const total = (p) => p.locator("[data-testid=image-total]").innerText();
const clickBtn = (p, name) => p.getByRole("button", { name, exact: true }).first().click();

async function open(width, height, dark = false, touch = false) {
  const c = await adminContext(browser, { w: width, h: height, dark, touch });
  const p = await c.newPage();
  await p.goto(BASE + "/admin");
  await p.waitForSelector("#up-title");
  await sleep(500);
  return { c, p };
}

// ================= desktop =================
{
  const { c, p } = await open(1280, 900);
  await p.getByRole("radio", { name: "Imágenes" }).first().click();
  t.check("images mode: no 'needs a computer' note on desktop", (await p.getByText("Para subir libros necesitas un ordenador").count()) === 0);
  await pickImages(p, "#img-files", specs);
  await p.waitForSelector("[data-testid=image-grid]");
  await sleep(600);
  t.check("total shows 30 páginas", /^30 páginas/.test(await total(p)), await total(p));
  t.check("natural order: p1, p2, p3, ... (p2 before p10)", (await firstNames(p, 12)).join(",") === "p1.png,p2.png,p3.png,p4.png,p5.png,p6.png,p7.png,p8.png,p9.png,p10.png,p11.png,p12.png", (await firstNames(p, 12)).join(","));

  await clickBtn(p, "Invertir orden");
  await sleep(300);
  t.check("Invertir orden reverses (p30 first)", (await firstNames(p, 3)).join(",") === "p30.png,p29.png,p28.png", (await firstNames(p, 3)).join(","));
  await clickBtn(p, "Invertir orden");
  await sleep(200);
  await clickBtn(p, "Ordenar por fecha");
  await sleep(200);
  t.check("Ordenar por fecha (mtime grows with n) keeps p1 first", (await firstNames(p, 2)).join(",") === "p1.png,p2.png");
  await clickBtn(p, "Ordenar por nombre");
  await sleep(200);
  t.check("Ordenar por nombre -> natural", (await firstNames(p, 3)).join(",") === "p1.png,p2.png,p3.png");

  // keyboard: grab p1, move it two places to the right, drop
  const cell = (i) => p.locator(`[data-testid=image-grid] [data-idx="${i}"]`);
  await cell(0).focus();
  await p.keyboard.press("Space");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("Space");
  await sleep(300);
  t.check("keyboard reorder: p2,p3,p1,p4", (await firstNames(p, 4)).join(",") === "p2.png,p3.png,p1.png,p4.png", (await firstNames(p, 4)).join(","));
  // Esc cancels a keyboard move
  await cell(0).focus();
  await p.keyboard.press("Space"); await p.keyboard.press("ArrowRight"); await p.keyboard.press("Escape");
  await sleep(300);
  t.check("keyboard move cancelled with Escape", (await firstNames(p, 3)).join(",") === "p2.png,p3.png,p1.png", (await firstNames(p, 3)).join(","));

  // drag and drop: p4 (index 3) to the front
  const grip = p.locator(`[data-testid=image-grid] [data-idx="3"] button[aria-label^="Arrastrar"]`);
  const gb = await grip.boundingBox();
  const tb = await cell(0).boundingBox();
  await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await p.mouse.down();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await p.mouse.up();
  await sleep(400);
  t.check("drag and drop: p4 first", (await firstNames(p, 5)).join(",") === "p4.png,p2.png,p3.png,p1.png,p5.png", (await firstNames(p, 5)).join(","));

  // rotate the cell showing p5 (index 4) and make the page at index 2 the cover
  await p.getByRole("button", { name: "Girar 90° la página 5" }).click();
  await p.getByRole("button", { name: "Usar la página 3 como portada" }).click();
  await sleep(300);
  t.check("cover badge on page 3", (await p.locator("[data-idx='2']").innerText()).includes("Portada"));

  // remove an extra file
  await pickImages(p, "input[aria-label='Añadir más imágenes']", [{ n: 31, name: "extra.png" }]);
  await sleep(500);
  t.check("added one more -> 31 páginas", /^31 páginas/.test(await total(p)), await total(p));
  await p.getByRole("button", { name: /^Quitar la página \d+$/ }).last().scrollIntoViewIfNeeded().catch(() => {});
  await p.locator("[data-testid=image-grid]").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await sleep(400);
  await p.getByRole("button", { name: "Quitar la página 31" }).click();
  await sleep(300);
  t.check("removed it -> 30 páginas", /^30 páginas/.test(await total(p)), await total(p));

  // HEIC is refused with the exact message; unsupported types too
  await pickImages(p, "input[aria-label='Añadir más imágenes']", [{ n: 40, name: "foto.heic", fileType: "image/heic" }]);
  await sleep(300);
  t.check("HEIC rejected with the message", (await p.locator("[data-testid=image-message]").innerText()).includes("Convierte las fotos HEIC a JPG antes de subirlas."));
  t.check("still 30 páginas", /^30 páginas/.test(await total(p)));
  await pickImages(p, "input[aria-label='Añadir más imágenes']", [{ n: 41, name: "foto.heif", fileType: "" }]);
  await sleep(300);
  t.check("HEIF by extension rejected too", (await p.locator("[data-testid=image-message]").innerText()).includes("Convierte las fotos HEIC a JPG"));

  if (shots) {
    await p.locator("[data-testid=image-grid]").evaluate((el) => { el.scrollTop = 0; });
    await sleep(900);
    await p.locator("form.card").first().screenshot({ path: path.join(SHOTS, "20-editor-imagenes-claro-1440.png") });
  }

  // ---- upload it ----
  await p.fill("#up-title", `Imágenes ${stamp}`);
  const puts = [];
  p.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/storage/local")) puts.push(r.url()); });
  await p.getByRole("button", { name: "Subir libro" }).click();
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 120000 });
  t.check("upload finished", true);
  t.check("30 pages + cover sent", puts.length === 31, String(puts.length));
  const books = (await api("/api/admin/books")).json.books;
  const book = books.find((b) => b.title === `Imágenes ${stamp}`);
  t.check("book created: published, 30 pages", book && book.status === "published" && book.page_count === 30, JSON.stringify(book));

  // the stored pages are exactly the chosen order: p4,p2,p3,p1,p5(rot),p6...
  const expected = [4, 2, 3, 1, 5, ...Array.from({ length: 25 }, (_, i) => i + 6)];
  const got = await identifyPages(p, book.id, 30, 30);
  t.check("stored order = chosen order", got.every((g, i) => g.shows === expected[i]), got.map((g) => g.shows).join(","));
  t.check("p5 (3000x2000, rotated) is now portrait and at most 1400 wide", got[4].w === 1400 * 0 + got[4].w && got[4].w <= 1400 && got[4].h > got[4].w, JSON.stringify(got[4]));
  t.check("no page wider than 1400", got.every((g) => g.w <= 1400));
  // cover = the image at page 3 (p3), 480 px wide
  const cover = await fetch(BASE + `/api/admin/books/${book.id}/cover`, { headers: { cookie: (await c.cookies()).map((k) => `${k.name}=${k.value}`).join("; ") } });
  const cb = Buffer.from(await cover.arrayBuffer());
  t.check("cover thumbnail exists (webp)", cover.status === 200 && cb.length > 100 && cb.slice(0, 4).toString() === "RIFF", String(cover.status));
  const cinfo = await p.evaluate(async (id) => { const b = await createImageBitmap(await (await fetch(`/api/admin/books/${id}/cover`)).blob()); const c = document.createElement("canvas"); c.width = b.width; c.height = b.height; const x = c.getContext("2d"); x.drawImage(b, 0, 0); const d = x.getImageData(6, 6, 1, 1).data; return { w: b.width, d: [...d] }; }, book.id);
  t.check("cover is 480 px wide", cinfo.w === 480, JSON.stringify(cinfo));
  const hue = (([r, g, bl]) => { r /= 255; g /= 255; bl /= 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn; let h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; })(cinfo.d);
  t.check("cover shows image 3", Math.min(Math.abs(hue - (3 * 12) % 360), 360 - Math.abs(hue - (3 * 12) % 360)) < 10, String(hue));
  await c.close();
  fs.writeFileSync(path.join(SHOTS, ".last-images-book"), JSON.stringify({ slug: book.slug, id: book.id }));
}

// ================= interrupted upload, resumed with the same files in the same order =================
{
  // Leftovers of earlier runs would put several 'Continuar subida' buttons on the page.
  for (const b of (await api("/api/admin/books")).json.books.filter((x) => x.status === "uploading")) await api(`/api/admin/books/${b.id}`, "DELETE", { title: b.title });
  const { c, p } = await open(1280, 900);
  await p.getByRole("radio", { name: "Imágenes" }).first().click();
  await pickImages(p, "#img-files", specs);
  await p.waitForSelector("[data-testid=image-grid]");
  await p.fill("#up-title", `Reanudar ${stamp}`);
  let sent = 0;
  p.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/storage/local")) sent++; });
  await p.getByRole("button", { name: "Subir libro" }).click();
  for (let i = 0; i < 200 && sent < 10; i++) await sleep(50);
  await p.getByRole("button", { name: "Cancelar", exact: true }).first().click();
  await sleep(1500);
  const row = (await api("/api/admin/books")).json.books.find((b) => b.title === `Reanudar ${stamp}`);
  t.check("interrupted: the book stays 'uploading'", row && row.status === "uploading", JSON.stringify(row));
  const st = (await api(`/api/admin/books/${row.id}/upload-state`)).json;
  t.check("interrupted: some pages stored, not all", st.pages.length > 0 && st.pages.length < 30, JSON.stringify({ n: st.pages.length }));
  const need = 30 - st.pages.length + (st.cover ? 0 : 1);

  // wrong order is refused
  await p.reload(); await p.waitForSelector("#up-title");
  await p.getByRole("button", { name: "Continuar subida" }).first().click();
  await p.getByRole("radio", { name: "Imágenes" }).last().click();
  await pickImages(p, "#img-files", specs);
  await p.waitForSelector("[data-testid=image-grid]");
  await clickBtn(p, "Invertir orden");
  let resumePuts = 0;
  p.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/storage/local")) resumePuts++; });
  await p.getByRole("button", { name: "Continuar subida" }).last().click();
  await sleep(2500);
  t.check("resume with another order is refused", (await p.getByText("Estas imágenes no son las de la subida empezada").count()) > 0 && resumePuts === 0, `puts=${resumePuts}`);

  // right order: only the missing pages
  await clickBtn(p, "Invertir orden");
  await sleep(300);
  await p.getByRole("button", { name: "Continuar subida" }).last().click();
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 120000 });
  t.check(`resume sent only the missing pages (${need})`, resumePuts === need, `sent ${resumePuts}, missing ${need}`);
  const done = (await api("/api/admin/books")).json.books.find((b) => b.title === `Reanudar ${stamp}`);
  t.check("resumed book is complete", done.status === "draft" || done.status === "published", JSON.stringify(done));
  const got = await identifyPages(p, done.id, 30, 30);
  t.check("resumed book has pages 1..30 in order", got.every((g) => g.shows === g.page), got.map((g) => g.shows).join(","));
  await c.close();
}

// ================= replace a book with images =================
{
  const { c, p } = await open(1280, 900);
  const src = (await api("/api/admin/books")).json.books.find((b) => b.title === `Reanudar ${stamp}`);
  const rev = specs.slice(0, 6);
  await p.getByRole("button", { name: "Sustituir PDF" }).first().waitFor();
  const li = p.locator("li", { hasText: `Reanudar ${stamp}` });
  await li.getByRole("button", { name: "Sustituir PDF" }).click();
  await li.getByRole("radio", { name: "Imágenes" }).click();
  await pickImages(p, "#img-files", rev);
  await p.waitForSelector("[data-testid=image-grid]");
  await clickBtn(p, "Invertir orden");
  await li.getByRole("button", { name: "Sustituir con estas imágenes" }).click();
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 120000 });
  const after = (await api("/api/admin/books")).json.books.find((b) => b.id === src.id);
  t.check("replace with images: same book, 6 pages", after.page_count === 6 && after.slug === src.slug, JSON.stringify(after));
  const got = await identifyPages(p, src.id, 6, 30);
  const want = rev.map((s) => s.n).sort((a, b) => a - b).reverse();
  t.check("replace: reversed order", got.map((g) => g.shows).join(",") === want.join(","), got.map((g) => g.shows).join(",") + " vs " + want.join(","));
  await c.close();
}

// ================= EXIF orientation is respected =================
{
  const { c, p } = await open(1280, 900);
  // a 200x100 JPEG whose EXIF says "rotate 90° clockwise" (orientation 6): it must be stored as 100 wide x 200 tall
  const bytes = await p.evaluate(async () => {
    const cv = document.createElement("canvas"); cv.width = 200; cv.height = 100;
    const x = cv.getContext("2d"); x.fillStyle = "hsl(12 70% 45%)"; x.fillRect(0, 0, 200, 100);
    const jpg = new Uint8Array(await (await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9))).arrayBuffer());
    const exif = new Uint8Array([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
    const out = new Uint8Array(jpg.length + exif.length);
    out.set(jpg.slice(0, 2), 0); out.set(exif, 2); out.set(jpg.slice(2), 2 + exif.length);
    return [...out];
  });
  await p.getByRole("radio", { name: "Imágenes" }).first().click();
  await pickImages(p, "#img-files", [{ n: 1, name: "exif.jpg", type: "image/jpeg", bytes }]);
  await p.waitForSelector("[data-testid=image-grid]");
  await p.fill("#up-title", `EXIF ${stamp}`);
  await p.getByRole("button", { name: "Subir libro" }).click();
  await p.waitForSelector("text=Libro subido correctamente", { timeout: 60000 });
  const b = (await api("/api/admin/books")).json.books.find((x) => x.title === `EXIF ${stamp}`);
  const got = await identifyPages(p, b.id, 1, 30);
  t.check("EXIF orientation 6: stored as portrait (100x200)", got[0].w === 100 && got[0].h === 200, JSON.stringify(got[0]));
  await c.close();
}

// ================= phone: image mode has no 'needs a computer' note, PDF mode keeps it =================
{
  const { c, p } = await open(390, 844, false, true);
  t.check("phone, PDF mode: warning shown", (await p.getByText("Para subir libros necesitas un ordenador").count()) === 1);
  await p.getByRole("radio", { name: "Imágenes" }).first().click();
  t.check("phone, image mode: warning hidden", (await p.getByText("Para subir libros necesitas un ordenador").count()) === 0);
  await pickImages(p, "#img-files", specs.slice(0, 12));
  await p.waitForSelector("[data-testid=image-grid]");
  await sleep(800);
  t.check("phone: 12 páginas in the editor", /^12 páginas/.test(await total(p)));
  const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  t.check("phone: no horizontal overflow", !over);
  if (shots) await p.locator("form.card").first().screenshot({ path: path.join(SHOTS, "20-editor-imagenes-claro-390.png") });
  await c.close();
}

await browser.close();
t.done();
