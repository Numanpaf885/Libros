import { randomUUID } from "node:crypto";
import { isMock, PROGRESS_WRITE_GAP_MS, USERS_CACHE_MS } from "../config";
import { assertSafeConfig } from "../safety";
import { ALL_BOOKS, type PasskeyRecord, type ProgressRecord, type UserBookRecord, type UserRecord, type UserStatus } from "../types";
import { mockTable } from "./mock";
import { sheetsTable } from "./sheets";
import type { Table } from "./table";

const table = (): Table => {
  assertSafeConfig();
  return isMock() ? mockTable : sheetsTable;
};

const TABS = ["users", "user_books", "progress", "passkeys"] as const;

// ---- row <-> object ----
const num = (v: string | undefined, d = 0) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const toUser = (r: string[]): UserRecord => ({
  id: r[0], username: r[1], display_name: r[2], password_hash: r[3],
  status: r[4] === "active" ? "active" : r[4] === "disabled" ? "disabled" : "pending",
  setup_code_hash: r[5], setup_code_expires_at: r[6], setup_attempts: num(r[7]), failed_logins: num(r[8]),
  locked_until: r[9], session_version: num(r[10], 1), created_at: r[11], last_login_at: r[12],
});
const fromUser = (u: UserRecord): string[] => [
  u.id, u.username, u.display_name, u.password_hash, u.status, u.setup_code_hash, u.setup_code_expires_at,
  String(u.setup_attempts), String(u.failed_logins), u.locked_until, String(u.session_version), u.created_at, u.last_login_at,
];
const toUserBook = (r: string[]): UserBookRecord => ({ user_id: r[0], book_id: r[1], source: r[2] === "code" ? "code" : "admin", code_id: r[3], granted_at: r[4] });
const fromUserBook = (b: UserBookRecord): string[] => [b.user_id, b.book_id, b.source, b.code_id, b.granted_at];
const toProgress = (r: string[]): ProgressRecord => ({ user_id: r[0], book_id: r[1], page: num(r[2]), updated_at: r[3] });
const fromProgress = (p: ProgressRecord): string[] => [p.user_id, p.book_id, String(p.page), p.updated_at];
const toPasskey = (r: string[]): PasskeyRecord => ({
  id: r[0], user_id: r[1], credential_id: r[2], public_key: r[3], counter: num(r[4]), transports: r[5], label: r[6], created_at: r[7], last_used_at: r[8],
});
const fromPasskey = (p: PasskeyRecord): string[] => [p.id, p.user_id, p.credential_id, p.public_key, String(p.counter), p.transports, p.label, p.created_at, p.last_used_at];

// ---- snapshot cache: ONE batchGet for the four tabs, reused for USERS_CACHE_MS ----
interface Snap {
  at: number;
  users: UserRecord[];
  userBooks: UserBookRecord[];
  progress: ProgressRecord[];
  passkeys: PasskeyRecord[];
}
interface Store {
  snap: Snap | null;
  loading: Promise<Snap> | null;
  /** progress rows not yet written to the sheet (latest value per user+book) */
  pending: Map<string, ProgressRecord>;
  /** when each user+book was last written to the sheet */
  written: Map<string, number>;
  draining: Promise<void> | null;
}
const g = globalThis as unknown as { __usersStore?: Store };
const store = (g.__usersStore ??= { snap: null, loading: null, pending: new Map(), written: new Map(), draining: null });
const pkey = (userId: string, bookId: string) => `${userId}:${bookId}`;

async function snapshot(): Promise<Snap> {
  if (store.snap && Date.now() - store.snap.at < USERS_CACHE_MS) return store.snap;
  store.loading ??= (async () => {
    try {
      const d = await table().listMany([...TABS]);
      const snap: Snap = {
        at: Date.now(),
        users: d.users.filter((r) => r[0]).map(toUser),
        userBooks: d.user_books.filter((r) => r[0] && r[1]).map(toUserBook),
        progress: d.progress.filter((r) => r[0] && r[1]).map(toProgress),
        passkeys: d.passkeys.filter((r) => r[0]).map(toPasskey),
      };
      // Progress that is still waiting to be written is newer than the sheet.
      for (const p of store.pending.values()) upsertLocalProgress(snap, p);
      store.snap = snap;
      return snap;
    } finally {
      store.loading = null;
    }
  })();
  return store.loading;
}
function upsertLocalProgress(s: Snap, p: ProgressRecord) {
  const i = s.progress.findIndex((x) => x.user_id === p.user_id && x.book_id === p.book_id);
  if (i >= 0) s.progress[i] = p;
  else s.progress.push(p);
}
/** Drop the cache (tests, or after a failed write). */
export function resetUsersCache() {
  store.snap = null;
}

// ---- reads (no sheet request while the snapshot is fresh) ----
export async function listUsers(): Promise<UserRecord[]> {
  return (await snapshot()).users.map((u) => ({ ...u }));
}
export async function getUserById(id: string): Promise<UserRecord | null> {
  const u = (await snapshot()).users.find((x) => x.id === id);
  return u ? { ...u } : null;
}
export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  const n = username.trim().toLowerCase();
  const u = (await snapshot()).users.find((x) => x.username === n);
  return u ? { ...u } : null;
}
export async function userBookGrants(userId: string): Promise<UserBookRecord[]> {
  return (await snapshot()).userBooks.filter((b) => b.user_id === userId).map((b) => ({ ...b }));
}
export async function allGrants(): Promise<UserBookRecord[]> {
  return (await snapshot()).userBooks.map((b) => ({ ...b }));
}
export async function progressOf(userId: string): Promise<ProgressRecord[]> {
  return (await snapshot()).progress.filter((p) => p.user_id === userId).map((p) => ({ ...p }));
}
export async function allProgress(): Promise<ProgressRecord[]> {
  return (await snapshot()).progress.map((p) => ({ ...p }));
}
export async function progressFor(userId: string, bookId: string): Promise<number> {
  return (await snapshot()).progress.find((p) => p.user_id === userId && p.book_id === bookId)?.page ?? 0;
}
export async function passkeysOf(userId: string): Promise<PasskeyRecord[]> {
  return (await snapshot()).passkeys.filter((p) => p.user_id === userId).map((p) => ({ ...p }));
}
export async function passkeyByCredential(credentialId: string): Promise<PasskeyRecord | null> {
  const p = (await snapshot()).passkeys.find((x) => x.credential_id === credentialId);
  return p ? { ...p } : null;
}

// ---- user writes ----
function putUser(s: Snap, u: UserRecord) {
  const i = s.users.findIndex((x) => x.id === u.id);
  if (i >= 0) s.users[i] = u;
  else s.users.push(u);
}
/**
 * Read the user's FRESH row from the sheet, let `fn` change it, write it back and update the cache.
 * Fresh, so a stale cache on this server instance can never undo a change (reset, disable) made on another one.
 */
export async function modifyUser(id: string, fn: (u: UserRecord) => UserRecord | null): Promise<UserRecord | null> {
  let result: UserRecord | null = null;
  const row = await table().modifyWhere("users", [[0, id]], (r) => {
    const next = fn(toUser(r));
    if (!next) return null;
    result = next;
    return fromUser(next);
  });
  if (!row || !result) return null;
  putUser(await snapshot(), result);
  return { ...(result as UserRecord) };
}
export async function createUser(input: { username: string; display_name: string; setup_code_hash: string; setup_code_expires_at: string; books: "all" | string[] }): Promise<UserRecord> {
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: randomUUID(), username: input.username, display_name: input.display_name, password_hash: "", status: "pending",
    setup_code_hash: input.setup_code_hash, setup_code_expires_at: input.setup_code_expires_at, setup_attempts: 0, failed_logins: 0,
    locked_until: "", session_version: 1, created_at: now, last_login_at: "",
  };
  const grants = grantsFor(user.id, input.books, now);
  await table().append("users", fromUser(user));
  if (grants.length) await table().appendMany("user_books", grants.map(fromUserBook));
  const s = await snapshot();
  putUser(s, user);
  s.userBooks.push(...grants);
  return { ...user };
}
function grantsFor(userId: string, books: "all" | string[], now: string): UserBookRecord[] {
  const ids = books === "all" ? [ALL_BOOKS] : [...new Set(books)];
  return ids.map((book_id) => ({ user_id: userId, book_id, source: "admin" as const, code_id: "", granted_at: now }));
}
/** Replace the books the admin assigned. Books the user unlocked with a code are kept. */
export async function setAdminBooks(userId: string, books: "all" | string[]): Promise<void> {
  const now = new Date().toISOString();
  await table().deleteMatching("user_books", [[0, userId], [2, "admin"]]);
  const grants = grantsFor(userId, books, now);
  if (grants.length) await table().appendMany("user_books", grants.map(fromUserBook));
  const s = await snapshot();
  s.userBooks = s.userBooks.filter((b) => !(b.user_id === userId && b.source === "admin")).concat(grants);
}
/** Save a book unlocked with an access code to the account (no-op if the same code is already saved). */
export async function addCodeGrant(userId: string, bookId: string, codeId: string): Promise<void> {
  const s = await snapshot();
  if (s.userBooks.some((b) => b.user_id === userId && b.book_id === bookId && b.source === "code" && b.code_id === codeId)) return;
  const grant: UserBookRecord = { user_id: userId, book_id: bookId, source: "code", code_id: codeId, granted_at: new Date().toISOString() };
  await table().upsertMany("user_books", [0, 1, 2], [fromUserBook(grant)]);
  s.userBooks = s.userBooks.filter((b) => !(b.user_id === userId && b.book_id === bookId && b.source === "code")).concat(grant);
}
export async function deleteUserCascade(id: string): Promise<void> {
  await table().deleteMatching("users", [[0, id]]);
  await table().deleteMatching("user_books", [[0, id]]);
  await table().deleteMatching("progress", [[0, id]]);
  await table().deleteMatching("passkeys", [[1, id]]);
  const s = await snapshot();
  s.users = s.users.filter((u) => u.id !== id);
  s.userBooks = s.userBooks.filter((b) => b.user_id !== id);
  s.progress = s.progress.filter((p) => p.user_id !== id);
  s.passkeys = s.passkeys.filter((p) => p.user_id !== id);
  for (const k of [...store.pending.keys()]) if (k.startsWith(`${id}:`)) store.pending.delete(k);
}
export async function setStatus(id: string, status: UserStatus): Promise<UserRecord | null> {
  return modifyUser(id, (u) => ({ ...u, status }));
}

// ---- passkeys ----
export async function addPasskey(p: PasskeyRecord): Promise<void> {
  await table().append("passkeys", fromPasskey(p));
  (await snapshot()).passkeys.push(p);
}
export async function modifyPasskey(id: string, fn: (p: PasskeyRecord) => PasskeyRecord | null): Promise<void> {
  let result: PasskeyRecord | null = null;
  await table().modifyWhere("passkeys", [[0, id]], (r) => {
    const next = fn(toPasskey(r));
    if (!next) return null;
    result = next;
    return fromPasskey(next);
  });
  if (!result) return;
  const s = await snapshot();
  const i = s.passkeys.findIndex((x) => x.id === id);
  if (i >= 0) s.passkeys[i] = result;
}
export async function deletePasskey(id: string): Promise<void> {
  await table().deleteMatching("passkeys", [[0, id]]);
  const s = await snapshot();
  s.passkeys = s.passkeys.filter((p) => p.id !== id);
}
export async function deleteUserPasskeys(userId: string): Promise<void> {
  await table().deleteMatching("passkeys", [[1, userId]]);
  const s = await snapshot();
  s.passkeys = s.passkeys.filter((p) => p.user_id !== userId);
}

// ---- progress: cache first, then a coalesced write ----
/**
 * Records the page in the cache at once and queues the sheet write. Everything queued while a write is running (or
 * waiting out a 429) is sent together, newest value per user+book, so the latest page is never lost.
 */
export async function recordProgress(userId: string, bookId: string, page: number): Promise<void> {
  const rec: ProgressRecord = { user_id: userId, book_id: bookId, page, updated_at: new Date().toISOString() };
  store.pending.set(pkey(userId, bookId), rec);
  upsertLocalProgress(await snapshot(), rec);
}
/** Keep the higher page for each entry (used when a device signs in). Returns the resulting pages. */
export async function mergeProgress(userId: string, entries: { bookId: string; page: number }[]): Promise<Record<string, number>> {
  const s = await snapshot();
  const out: Record<string, number> = {};
  for (const e of entries) {
    const have = s.progress.find((p) => p.user_id === userId && p.book_id === e.bookId)?.page ?? 0;
    if (e.page > have) await recordProgress(userId, e.bookId, e.page);
    out[e.bookId] = Math.max(have, e.page);
  }
  return out;
}
/**
 * Single-flight writer. Safe to call as often as you like (route handlers call it from `after`).
 * Each user+book is written at most once every PROGRESS_WRITE_GAP_MS; whatever arrives in between replaces the
 * pending value, and the drain waits out the gap, so the sheet always ends with the latest page.
 */
export function drainProgress(): Promise<void> {
  if (store.draining) return store.draining;
  if (!store.pending.size) return Promise.resolve();
  const run: Promise<void> = (async () => {
    while (store.pending.size) {
      const now = Date.now();
      const due = [...store.pending.entries()].filter(([k]) => now - (store.written.get(k) ?? 0) >= PROGRESS_WRITE_GAP_MS);
      if (!due.length) {
        const next = Math.min(...[...store.pending.keys()].map((k) => (store.written.get(k) ?? 0) + PROGRESS_WRITE_GAP_MS));
        await new Promise((r) => setTimeout(r, Math.max(50, next - now)));
        continue;
      }
      const batch = due.map(([, r]) => r);
      try {
        await table().upsertMany("progress", [0, 1], batch.map(fromProgress));
      } catch (e) {
        console.error("progress write failed, will retry", e);
        retryLater();
        return;
      }
      const t = Date.now();
      for (const r of batch) {
        const k = pkey(r.user_id, r.book_id);
        store.written.set(k, t);
        if (store.pending.get(k) === r) store.pending.delete(k);
      }
    }
  })();
  // Cleared only after the promise exists (an async function that finishes without awaiting would clear it too early).
  store.draining = run;
  void run.finally(() => { if (store.draining === run) store.draining = null; });
  return run;
}
let retryTimer: ReturnType<typeof setTimeout> | null = null;
function retryLater() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void drainProgress(); }, 30_000);
  retryTimer.unref?.();
}
export const pendingProgressCount = () => store.pending.size;
