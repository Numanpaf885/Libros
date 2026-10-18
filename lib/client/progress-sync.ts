import { getMe } from "./me";

// Reading progress of a signed-in reader goes to the server at most once every 20 s per book, plus once when the
// page is hidden or the reader closes (sendBeacon). The server keeps it in memory and writes the sheet in batches.
const INTERVAL_MS = 20_000;
const URL_PROGRESS = "/api/me/progress";
interface Entry { page: number; lastSent: number; dirty: boolean; timer: ReturnType<typeof setTimeout> | null }
const entries = new Map<string, Entry>();
let hooked = false;

function hook() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
  window.addEventListener("pagehide", () => flushAll());
}
const body = (slug: string, page: number) => JSON.stringify({ slug, page });

function send(slug: string) {
  const e = entries.get(slug);
  if (!e) return;
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  if (!e.dirty) return;
  e.dirty = false;
  e.lastSent = Date.now();
  const page = e.page;
  fetch(URL_PROGRESS, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(slug, page), keepalive: true })
    .then((r) => { if (!r.ok && r.status !== 401 && r.status !== 404) throw new Error("save failed"); })
    .catch(() => { // keep the latest page and try again later
      const cur = entries.get(slug);
      if (cur) { cur.dirty = true; cur.timer ??= setTimeout(() => send(slug), INTERVAL_MS); }
    });
}
/** Called on every page change while reading. A no-op when nobody is signed in. */
export function reportPage(slug: string, page: number) {
  if (!getMe()) return;
  hook();
  const e = entries.get(slug) ?? { page, lastSent: 0, dirty: false, timer: null };
  entries.set(slug, e);
  e.page = page;
  e.dirty = true;
  const wait = e.lastSent + INTERVAL_MS - Date.now();
  if (wait <= 0) send(slug);
  else e.timer ??= setTimeout(() => send(slug), wait);
}
/** Send whatever is waiting, now. `beacon` survives the page being closed. */
export function flushAll() {
  for (const [slug, e] of entries) {
    if (!e.dirty) continue;
    e.dirty = false;
    e.lastSent = Date.now();
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    const blob = new Blob([body(slug, e.page)], { type: "application/json" });
    if (!(typeof navigator !== "undefined" && navigator.sendBeacon?.(URL_PROGRESS, blob))) send2(slug, e.page);
  }
}
function send2(slug: string, page: number) {
  fetch(URL_PROGRESS, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(slug, page), keepalive: true }).catch(() => {});
}
export const flushBook = (slug: string) => { const e = entries.get(slug); if (e?.dirty) send(slug); };

/** After signing in: this device's own pages are merged into the account (the higher page wins) and written back. */
export async function mergeLocalProgress(): Promise<void> {
  const local: { slug: string; page: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && /^br:last:(.+)$/.exec(k);
      const v = m ? Number(localStorage.getItem(k)) : 0;
      if (m && Number.isInteger(v) && v >= 1) local.push({ slug: m[1], page: v });
    }
  } catch { /* storage blocked */ }
  try {
    const res = await fetch("/api/me/progress/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: local.slice(0, 300) }) });
    if (!res.ok) return;
    const { progress } = (await res.json()) as { progress: Record<string, number> };
    for (const [slug, page] of Object.entries(progress)) {
      try { if (page > Number(localStorage.getItem(`br:last:${slug}`) ?? 0)) localStorage.setItem(`br:last:${slug}`, String(page)); } catch { /* ignore */ }
    }
  } catch { /* offline: it will be merged next time */ }
}
