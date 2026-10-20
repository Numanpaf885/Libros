// Helpers for the download / image-upload tests. Mock mode only.
import { BASE, adminContext, counter, launch, sleep } from "./lib.mjs";
export { BASE, counter, launch, sleep };

export const colorOf = (n) => `hsl(${(n * 47) % 360} 70% 45%)`;

/** Creates a published book of `pages` pages inside a browser page that is signed in as admin. Page n is a solid colour
 *  (colorOf(n)) with its number written on it, and its height depends on n, so a PDF made from it shows the order. */
export async function seedBook(page, opts) {
  // The dev server may reload the page once after the first compile; let that happen before evaluating.
  // A bare SVG has no dev HMR client, so mock-data writes cannot reload it mid-seed.
  await page.goto(BASE + "/icon.svg");
  for (let i = 0; ; i++) {
    try { return await seedBookOnce(page, opts); }
    catch (e) { if (i >= 2 || !/context was destroyed|navigation/i.test(String(e))) throw e; await page.waitForLoadState("load").catch(() => {}); await sleep(1500); }
  }
}
async function seedBookOnce(page, { title, pages, w = 800, hOf = (n) => 1000 + (n % 7) * 20, rich = false }) {
  return page.evaluate(async ({ title, pages, w, hs, rich }) => {
    const j = async (u, m, b) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
    const { book } = await j("/api/admin/books", "POST", { title, page_count: pages });
    const draw = async (n) => {
      const h = hs[n - 1] ?? hs[0];
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = `hsl(${(n * 47) % 360} 70% 45%)`; x.fillRect(0, 0, w, h);
      if (rich) { // texture, so the JPEGs have a realistic size (a few hundred KB)
        let seed = n * 2654435761 % 4294967296;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        for (let i = 0; i < 700; i++) { x.fillStyle = `hsla(${rnd() * 360} 60% ${30 + rnd() * 50}% / ${0.25 + rnd() * 0.5})`; x.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 160, 4 + rnd() * 60); }
        for (let i = 0; i < 400; i++) { x.strokeStyle = `hsla(${rnd() * 360} 50% 20% / 0.5)`; x.lineWidth = 1 + rnd() * 3; x.beginPath(); x.moveTo(rnd() * w, rnd() * h); x.lineTo(rnd() * w, rnd() * h); x.stroke(); }
      }
      x.fillStyle = "#fff"; x.font = "bold 160px sans-serif"; x.textAlign = "center"; x.fillText(String(n), w / 2, h / 2);
      return new Promise((res) => c.toBlob(res, "image/webp", 0.8));
    };
    const all = [0, ...Array.from({ length: pages }, (_, i) => i + 1)];
    for (let i = 0; i < all.length; i += 20) {
      const chunk = all.slice(i, i + 20);
      const { urls } = await j("/api/admin/upload-urls", "POST", { book_id: book.id, pages: chunk });
      await Promise.all(urls.map(async (u) => {
        const blob = await draw(u.page === 0 ? 1 : u.page);
        const r = await fetch(u.url, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" } });
        if (!r.ok) throw new Error("put " + r.status);
      }));
    }
    const done = await j(`/api/admin/books/${book.id}/finalize`, "POST", { status: "published" });
    return done.book;
  }, { title, pages, w, hs: Array.from({ length: pages }, (_, i) => hOf(i + 1)), rich });
}
export { adminContext };

/** Puts generated images into an <input type=file> inside the page (so name, type and lastModified are exact). */
export async function pickImages(page, selector, specs) {
  await page.evaluate(async ({ selector, specs }) => {
    const dt = new DataTransfer();
    for (const s of specs) {
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); c.width = s.w ?? 600; c.height = s.h ?? 800;
      const x = c.getContext("2d");
      x.fillStyle = `hsl(${(s.n * 12) % 360} 70% 45%)`; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#fff"; x.font = "bold 200px sans-serif"; x.textAlign = "center"; x.fillText(String(s.n), c.width / 2, c.height / 2);
      const type = s.type ?? "image/png";
      const blob = await new Promise((res) => c.toBlob(res, type, 0.9));
      dt.items.add(new File([s.bytes ? new Uint8Array(s.bytes) : blob], s.name, { type: s.fileType ?? type, lastModified: s.mtime ?? 1_700_000_000_000 + s.n * 1000 }));
    }
    const input = document.querySelector(selector);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, specs });
}

/** Reads every stored page of a book as the admin and says which numbered colour (1..max) it shows plus its size. */
export async function identifyPages(page, bookId, count, max) {
  return page.evaluate(async ({ bookId, count, max }) => {
    const hueOf = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const out = [];
    for (let i = 1; i <= count; i += 20) {
      const pages = Array.from({ length: Math.min(20, count - i + 1) }, (_, k) => i + k);
      const r = await fetch(`/api/admin/books/${bookId}/page-urls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages }) });
      for (const u of (await r.json()).urls) {
        const bmp = await createImageBitmap(await (await fetch(u.url)).blob());
        const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(6, 6, 1, 1).data;
        const h = hueOf(d[0], d[1], d[2]);
        let best = 0, bd = 999;
        for (let n = 1; n <= max; n++) { const e = (n * 12) % 360; const dist = Math.min(Math.abs(e - h), 360 - Math.abs(e - h)); if (dist < bd) { bd = dist; best = n; } }
        out.push({ page: u.page, shows: best, w: bmp.width, h: bmp.height });
        bmp.close();
      }
    }
    return out.sort((a, b) => a.page - b.page);
  }, { bookId, count, max });
}

/** Finds a book by title (admin API) or creates it. */
export async function ensureBook(page, api, opts) {
  const have = (await api("/api/admin/books")).json.books.find((b) => b.title === opts.title && b.status === "published");
  return have ?? seedBook(page, opts);
}
