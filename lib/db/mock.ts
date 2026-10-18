import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Table, TabName } from "./table";
import { TABS } from "./table";

const FILE = path.join(process.cwd(), ".data", "mock-sheet.json");
type State = Record<TabName, string[][]>;
const g = globalThis as unknown as { __mockSheet?: State };

function load(): State {
  if (g.__mockSheet) return g.__mockSheet;
  let st: State | null = null;
  try {
    st = JSON.parse(fs.readFileSync(FILE, "utf8")) as State;
  } catch {
    st = null;
  }
  if (!st) {
    const pw = process.env.MOCK_ADMIN_PASSWORD || "admin123";
    st = {
      books: [],
      access_codes: [],
      admins: [["admin", bcrypt.hashSync(pw, 10)]],
      users: [],
      user_books: [],
      progress: [],
      passkeys: [],
      bookmarks: [],
    };
  }
  // Older mock files do not have the tabs added later.
  const full = st;
  for (const tab of Object.keys(TABS) as TabName[]) full[tab] ??= [];
  g.__mockSheet = full;
  return full;
}
function persist(st: State) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(st));
  } catch {
    /* in-memory remains authoritative */
  }
}

// Mock mode keeps a log of the requests the real Sheets backend would make (one line per API call),
// so tests can count reads and writes against the quota. Format: "<epoch ms> <read|write> <tab>".
// Outside the project folder on purpose: `next dev` reloads the page whenever a watched file changes.
const OPS = process.env.MOCK_OPS_LOG || path.join(os.tmpdir(), "libros-mock-sheet-ops.log");
function op(kind: "read" | "write", tab: string, n = 1) {
  try {
    fs.appendFileSync(OPS, `${`${Date.now()} ${kind} ${tab}\n`.repeat(n)}`);
  } catch { /* ignore */ }
}
const matches = (r: string[], m: [number, string][]) => m.every(([c, v]) => r[c] === v);
// Tests only: MOCK_MISSING_TABS=bookmarks behaves like a Sheet without that tab (Google answers 400 "Unable to parse range").
const missing = (tab: string) => (process.env.MOCK_MISSING_TABS ?? "").split(",").some((t) => t && tab.split("+").includes(t.trim()));
function guard(tab: string) {
  if (missing(tab)) throw Object.assign(new Error(`Unable to parse range: ${tab}!A2:F`), { code: 400 });
}

export const mockTable: Table = {
  async list(tab) {
    guard(tab);
    op("read", tab);
    return load()[tab as TabName].map((r) => [...r]);
  },
  async listMany(tabs) {
    guard(tabs.join("+"));
    op("read", tabs.join("+"));
    const st = load();
    return Object.fromEntries(tabs.map((t) => [t, st[t as TabName].map((r) => [...r])]));
  },
  async append(tab, row) {
    guard(tab);
    op("write", tab);
    const st = load();
    st[tab as TabName].push([...row]);
    persist(st);
  },
  async appendMany(tab, rows) {
    if (!rows.length) return;
    guard(tab);
    op("write", tab);
    const st = load();
    for (const r of rows) st[tab as TabName].push([...r]);
    persist(st);
  },
  async modifyWhere(tab, match, fn) {
    guard(tab);
    op("read", tab);
    const st = load();
    const i = st[tab as TabName].findIndex((r) => matches(r, match));
    if (i < 0) return null;
    const next = fn([...st[tab as TabName][i]]);
    if (!next) return null;
    op("write", tab);
    st[tab as TabName][i] = [...next];
    persist(st);
    return [...next];
  },
  async upsertMany(tab, keyCols, rows) {
    if (!rows.length) return;
    guard(tab);
    op("read", tab);
    const st = load();
    const list = st[tab as TabName];
    let updated = false;
    const fresh: string[][] = [];
    for (const row of rows) {
      const i = list.findIndex((r) => keyCols.every((c) => r[c] === row[c]));
      if (i >= 0) { list[i] = [...row]; updated = true; } else fresh.push([...row]);
    }
    if (updated) op("write", tab);
    if (fresh.length) { op("write", tab); for (const r of fresh) list.push(r); }
    persist(st);
  },
  async applyRows(tab, removeIds, add) {
    if (!removeIds.length && !add.length) return;
    guard(tab);
    if (removeIds.length) op("read", tab);
    const st = load();
    const gone = new Set(removeIds);
    st[tab as TabName] = st[tab as TabName].filter((r) => !gone.has(r[0]));
    for (const r of add) st[tab as TabName].push([...r]);
    op("write", tab);
    persist(st);
  },
  async deleteMatching(tab, match) {
    guard(tab);
    op("read", tab, 2); // rows + sheet id
    const st = load();
    const before = st[tab as TabName].length;
    st[tab as TabName] = st[tab as TabName].filter((r) => !matches(r, match));
    const n = before - st[tab as TabName].length;
    if (n) op("write", tab);
    persist(st);
    return n;
  },
  async updateById(tab, id, row) {
    guard(tab);
    op("read", tab);
    const st = load();
    const rows = st[tab as TabName];
    const i = rows.findIndex((r) => r[0] === id);
    if (i < 0) return false;
    op("write", tab);
    rows[i] = [...row];
    persist(st);
    return true;
  },
  async deleteWhere(tab, col, value) {
    op("read", tab, 2);
    const st = load();
    const before = st[tab as TabName].length;
    st[tab as TabName] = st[tab as TabName].filter((r) => r[col] !== value);
    persist(st);
    const n = before - st[tab as TabName].length;
    if (n) op("write", tab);
    return n;
  },
};
void TABS;
