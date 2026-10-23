import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expectedColumns, type SheetAdmin } from "../sheet-schema";
import type { Table, TabName } from "./table";
import { EXTRA_COLS, TABS } from "./table";

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
      downloads: [],
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
// Row 1 of each tab. The mock stores no header row, so it is simulated here, in memory: every tab and column of the
// schema, except what the test flags leave out. MOCK_MISSING_TABS=bookmarks behaves like a Sheet without that tab
// (Google answers 400 "Unable to parse range"); MOCK_MISSING_COLUMNS=can_download like a `users` tab that has not got
// that column yet, nor any column added after it. "Actualizar base de datos" (mockSheetAdmin below) fills them in; a
// restart starts again from the flags.
const flag = (name: string) => (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const gh = globalThis as unknown as { __mockHeaders?: Record<string, string[]> };
function headerState(): Record<string, string[]> {
  if (!gh.__mockHeaders) {
    const tabs = flag("MOCK_MISSING_TABS"), cols = flag("MOCK_MISSING_COLUMNS");
    const upTo = (t: TabName) => { const all = expectedColumns(t); const i = all.findIndex((c) => cols.includes(c)); return i < 0 ? all : all.slice(0, i); };
    gh.__mockHeaders = Object.fromEntries((Object.keys(TABS) as TabName[]).filter((t) => !tabs.includes(t)).map((t) => [t, upTo(t)]));
  }
  return gh.__mockHeaders;
}
const missing = (tab: string) => tab.split("+").some((t) => !headerState()[t]);
/** Rows of a tab as the real Sheets backend would return/store them (without columns the sheet does not have). */
function width(tab: string): number {
  const head = headerState()[tab] ?? [];
  let w = TABS[tab as TabName].length;
  for (const name of (EXTRA_COLS as Record<string, readonly string[]>)[tab] ?? []) {
    if (head[w] !== name) break;
    w++;
  }
  return w;
}
const out = (tab: string, r: string[]): string[] => {
  const w = width(tab);
  const o = r.slice(0, w);
  while (o.length < w) o.push("");
  return o;
};
const inn = (tab: string, r: string[]): string[] => r.slice(0, width(tab));
function guard(tab: string) {
  if (missing(tab)) throw Object.assign(new Error(`Unable to parse range: ${tab}!A2:F`), { code: 400 });
}

export const mockTable: Table = {
  async list(tab) {
    guard(tab);
    op("read", tab);
    return load()[tab as TabName].map((r) => out(tab, r));
  },
  async listMany(tabs) {
    guard(tabs.join("+"));
    op("read", tabs.join("+"));
    const st = load();
    return Object.fromEntries(tabs.map((t) => [t, st[t as TabName].map((r) => out(t, r))]));
  },
  async append(tab, row) {
    guard(tab);
    op("write", tab);
    const st = load();
    st[tab as TabName].push(inn(tab, row));
    persist(st);
  },
  async appendMany(tab, rows) {
    if (!rows.length) return;
    guard(tab);
    op("write", tab);
    const st = load();
    for (const r of rows) st[tab as TabName].push(inn(tab, r));
    persist(st);
  },
  async modifyWhere(tab, match, fn) {
    guard(tab);
    op("read", tab);
    const st = load();
    const i = st[tab as TabName].findIndex((r) => matches(r, match));
    if (i < 0) return null;
    const next = fn(out(tab, st[tab as TabName][i]));
    if (!next) return null;
    op("write", tab);
    st[tab as TabName][i] = inn(tab, next);
    persist(st);
    return out(tab, next);
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
      if (i >= 0) { list[i] = inn(tab, row); updated = true; } else fresh.push(inn(tab, row));
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
    rows[i] = inn(tab, row);
    persist(st);
    return true;
  },
  async hasColumn(tab, index, name) {
    return headerState()[tab]?.[index] === name;
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

/** "Actualizar base de datos" in mock mode: it changes only the simulated row 1 above, never a stored row. */
export const mockSheetAdmin: SheetAdmin = {
  async tabs() {
    op("read", "meta");
    return Object.keys(headerState());
  },
  async headerRows(tabs) {
    op("read", tabs.join("+"));
    return Object.fromEntries(tabs.map((t) => [t, [...(headerState()[t] ?? [])]]));
  },
  async createTabs(tabs) {
    op("write", "meta");
    for (const t of tabs) headerState()[t] ??= [];
  },
  async writeHeaders(cells) {
    op("write", cells.map((c) => c.tab).join("+"));
    for (const c of cells) {
      const row = (headerState()[c.tab] ??= []);
      while (row.length < c.from - 1) row.push("");
      c.names.forEach((n, i) => { row[c.from - 1 + i] = n; });
    }
  },
};
