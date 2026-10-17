import fs from "node:fs";
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
    };
  }
  g.__mockSheet = st;
  return st;
}
function persist(st: State) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(st));
  } catch {
    /* in-memory remains authoritative */
  }
}

export const mockTable: Table = {
  async list(tab) {
    return load()[tab as TabName].map((r) => [...r]);
  },
  async append(tab, row) {
    const st = load();
    st[tab as TabName].push([...row]);
    persist(st);
  },
  async updateById(tab, id, row) {
    const st = load();
    const rows = st[tab as TabName];
    const i = rows.findIndex((r) => r[0] === id);
    if (i < 0) return false;
    rows[i] = [...row];
    persist(st);
    return true;
  },
  async deleteWhere(tab, col, value) {
    const st = load();
    const before = st[tab as TabName].length;
    st[tab as TabName] = st[tab as TabName].filter((r) => r[col] !== value);
    persist(st);
    return before - st[tab as TabName].length;
  },
};
void TABS;
