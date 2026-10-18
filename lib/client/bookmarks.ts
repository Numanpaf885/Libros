import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ensureMe } from "./me";

export interface Bookmark { id: string; page: number; label: string; created_at: string }
type Op = { op: "add"; id: string; page: number; label: string } | { op: "remove"; id: string } | { op: "rename"; id: string; label: string };
/** "loading": reading; "local": kept on this device (signed out, or the sheet has no bookmarks tab); "sync": kept on the account. */
interface State { items: Bookmark[]; mode: "loading" | "local" | "sync" }

export const MAX_LABEL = 60;
export const LIMIT = 100;
const QUIET_MS = 2000; // changes made within 2 s of each other go out as one request...
const MAX_WAIT_MS = 5000; // ...but never wait longer than this
const localKey = (slug: string) => `br:bm:${slug}`;
const queueKey = (slug: string) => `br:bmq:${slug}`;

interface Book { state: State; queue: Op[]; timer: ReturnType<typeof setTimeout> | null; firstAt: number; fails: number; started: boolean; inflight: boolean }
const books = new Map<string, Book>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const get = (slug: string): Book => {
  let b = books.get(slug);
  if (!b) books.set(slug, (b = { state: { items: [], mode: "loading" }, queue: [], timer: null, firstAt: 0, fails: 0, started: false, inflight: false }));
  return b;
};
const set = (slug: string, patch: Partial<State>) => { const b = get(slug); b.state = { ...b.state, ...patch }; notify(); };

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { if (v === null || (Array.isArray(v) && !v.length)) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const clean = (x: unknown): Bookmark[] =>
  (Array.isArray(x) ? x : []).flatMap((i) => {
    const o = i as Partial<Bookmark>;
    return typeof o?.page === "number" && Number.isInteger(o.page) && o.page >= 1 ? [{ id: typeof o.id === "string" ? o.id : crypto.randomUUID(), page: o.page, label: String(o.label ?? `Página ${o.page}`).slice(0, MAX_LABEL), created_at: String(o.created_at ?? new Date().toISOString()) }] : [];
  });

/** The same rules as the server, so the screen can change before the answer arrives. */
function applyOps(items: Bookmark[], ops: Op[]): Bookmark[] {
  let out = items;
  for (const o of ops) {
    if (o.op === "add") { if (!out.some((b) => b.id === o.id || b.page === o.page) && out.length < LIMIT) out = [...out, { id: o.id, page: o.page, label: o.label || `Página ${o.page}`, created_at: new Date().toISOString() }]; }
    else if (o.op === "remove") out = out.filter((b) => b.id !== o.id);
    else out = out.map((b) => (b.id === o.id ? { ...b, label: o.label || `Página ${b.page}` } : b));
  }
  return out;
}
const sorted = (l: Bookmark[]) => [...l].sort((a, b) => a.page - b.page);

// ---- talking to the server ----
const json = { "Content-Type": "application/json" };
async function fetchList(slug: string): Promise<{ available: boolean; bookmarks: Bookmark[] } | null> {
  try {
    const r = await fetch(`/api/bookmarks?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as { available: boolean; bookmarks: Bookmark[] }) : null;
  } catch { return null; }
}
function schedule(slug: string) {
  const b = get(slug);
  if (b.timer) clearTimeout(b.timer);
  if (!b.firstAt) b.firstAt = Date.now();
  const wait = Math.max(0, Math.min(QUIET_MS, b.firstAt + MAX_WAIT_MS - Date.now()));
  b.timer = setTimeout(() => void flush(slug), wait);
}
async function flush(slug: string) {
  const b = get(slug);
  if (b.timer) { clearTimeout(b.timer); b.timer = null; }
  if (b.inflight || !b.queue.length || b.state.mode !== "sync") return;
  const ops = b.queue.splice(0);
  b.firstAt = 0;
  b.inflight = true;
  try {
    const r = await fetch("/api/bookmarks", { method: "POST", headers: json, body: JSON.stringify({ slug, ops }), keepalive: true });
    if (r.status === 401 || r.status === 404) { // signed out meanwhile: keep everything on the device
      b.queue.unshift(...ops);
      const items = applyOps(b.state.items, []);
      write(queueKey(slug), null); write(localKey(slug), items); b.queue = [];
      set(slug, { mode: "local" });
      return;
    }
    if (r.status === 409) { // limit: take the server's list as the truth
      const l = await fetchList(slug);
      b.queue = []; write(queueKey(slug), null);
      if (l?.available) set(slug, { items: l.bookmarks });
      return;
    }
    if (!r.ok) throw new Error("save failed");
    const d = (await r.json()) as { available: boolean; bookmarks: Bookmark[] };
    if (!d.available) { // the tab disappeared: carry on on the device
      write(localKey(slug), applyOps(b.state.items, [])); b.queue = []; write(queueKey(slug), null);
      set(slug, { mode: "local" });
      return;
    }
    b.fails = 0;
    write(queueKey(slug), b.queue);
    set(slug, { items: applyOps(d.bookmarks, b.queue) }); // the server's list, plus anything changed since this request left
  } catch {
    b.queue.unshift(...ops); // never lose the latest state: put it back and try again, slower each time
    write(queueKey(slug), b.queue);
    b.fails = Math.min(b.fails + 1, 5);
    if (b.timer) clearTimeout(b.timer);
    b.timer = setTimeout(() => void flush(slug), Math.min(60_000, 3000 * 2 ** b.fails));
  } finally {
    b.inflight = false;
    if (b.queue.length && !b.timer) schedule(slug);
  }
}
/** Page hidden or closed: send what is waiting. */
function flushNow() {
  for (const [slug, b] of books) {
    if (b.state.mode !== "sync" || !b.queue.length) continue;
    const blob = new Blob([JSON.stringify({ slug, ops: b.queue })], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/bookmarks", blob)) { b.queue = []; write(queueKey(slug), null); if (b.timer) { clearTimeout(b.timer); b.timer = null; } }
  }
}
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
    else for (const [slug, b] of books) if (b.state.mode === "sync" && !b.queue.length && !b.inflight) void fetchList(slug).then((l) => { if (l?.available && !b.queue.length) set(slug, { items: l.bookmarks }); });
  });
  window.addEventListener("pagehide", flushNow);
}

async function init(slug: string) {
  const b = get(slug);
  if (b.started) return;
  b.started = true;
  hook();
  const local = clean(read(localKey(slug), []));
  set(slug, { items: local, mode: "loading" });
  const me = await ensureMe();
  const list = me ? await fetchList(slug) : null;
  if (!list || !list.available) { set(slug, { items: local, mode: "local" }); return; }
  // signed in and the sheet has the tab: the account is the truth. Bookmarks made on this device (while signed out,
  // or before the tab existed) are merged in, skipping pages that already have one; then the local copy is dropped.
  const pending = read<Op[]>(queueKey(slug), []);
  const known = new Set(list.bookmarks.map((x) => x.page));
  const merge: Op[] = local.filter((x) => !known.has(x.page)).slice(0, LIMIT).map((x) => ({ op: "add", id: crypto.randomUUID(), page: x.page, label: x.label }));
  b.queue = [...pending, ...merge];
  write(localKey(slug), null);
  write(queueKey(slug), b.queue);
  set(slug, { items: applyOps(list.bookmarks, b.queue), mode: "sync" });
  if (b.queue.length) schedule(slug);
}

function commit(slug: string, ops: Op[]) {
  const b = get(slug);
  if (b.state.mode === "loading") return;
  const items = applyOps(b.state.items, ops);
  if (b.state.mode === "local") { write(localKey(slug), items); set(slug, { items }); return; }
  for (const o of ops) { // an add that never left the device and is removed again cancels out
    if (o.op === "remove") { const i = b.queue.findIndex((q) => q.op === "add" && q.id === o.id); if (i >= 0) { b.queue.splice(i, 1); continue; } }
    b.queue.push(o);
  }
  write(queueKey(slug), b.queue);
  set(slug, { items });
  if (b.queue.length) schedule(slug); else if (b.timer) { clearTimeout(b.timer); b.timer = null; }
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const EMPTY: State = { items: [], mode: "loading" };

export function useBookmarks(slug: string, pageCount: number) {
  const state = useSyncExternalStore(subscribe, () => get(slug).state, () => EMPTY);
  useEffect(() => { void init(slug); }, [slug]);
  const items = useMemo(() => sorted(state.items), [state.items]);
  const marks = useMemo(() => new Set(items.map((i) => i.page)), [items]);
  const add = useCallback((page: number, label = "") => {
    if (page < 1 || page > pageCount) return null;
    const id = crypto.randomUUID();
    commit(slug, [{ op: "add", id, page, label: label.slice(0, MAX_LABEL) }]);
    return id;
  }, [slug, pageCount]);
  const remove = useCallback((id: string) => commit(slug, [{ op: "remove", id }]), [slug]);
  const rename = useCallback((id: string, label: string) => commit(slug, [{ op: "rename", id, label: label.trim().slice(0, MAX_LABEL) }]), [slug]);
  return { items, marks, ready: state.mode !== "loading", synced: state.mode === "sync", add, remove, rename };
}
