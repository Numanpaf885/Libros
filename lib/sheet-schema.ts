// The Google Sheet's schema (every tab and its header row) and the code that brings a sheet up to date.
// Shared by `npm run setup-sheet` and the admin "Mantenimiento" section (/api/admin/maintenance). The script runs this
// file directly in Node, so it imports nothing at runtime and uses only TypeScript that Node can strip.
//
// A feature that needs a new tab adds it to TABS. A feature that needs a new column on an existing tab adds it at the
// END of that tab's EXTRA_COLS list (never in the middle, never renamed): the app reads columns by position.
// Updating a sheet only ever creates missing tabs and writes missing header names after the last header of row 1.
// It never reorders, renames or deletes anything and never touches a data row.
import type { sheets_v4 } from "googleapis";

/** Every tab, with the columns it had when it was created, in sheet order. */
export const TABS = {
  books: ["id", "slug", "title", "description", "page_count", "storage_prefix", "cover_path", "status", "updated_at", "author", "category", "year"],
  access_codes: ["id", "book_id", "code_hash", "label", "created_at", "expires_at", "revoked"],
  admins: ["username", "password_hash"],
  users: ["id", "username", "display_name", "password_hash", "status", "setup_code_hash", "setup_code_expires_at", "setup_attempts", "failed_logins", "locked_until", "session_version", "created_at", "last_login_at"],
  user_books: ["user_id", "book_id", "source", "code_id", "granted_at"],
  progress: ["user_id", "book_id", "page", "updated_at"],
  passkeys: ["id", "user_id", "credential_id", "public_key", "counter", "transports", "label", "created_at", "last_used_at"],
  bookmarks: ["id", "user_id", "book_id", "page", "label", "created_at"],
  downloads: ["id", "actor", "user_id", "username", "display_name", "book_id", "book_title", "from_page", "to_page", "page_count", "device", "status", "created_at", "finished_at"],
} as const;
/** Columns appended at the END of an existing tab later, in this order. The app uses one only once its header exists. */
export const EXTRA_COLS = {
  users: ["can_download"],
  books: ["page_labels", "original_pdf_size", "original_pdf_pages", "text_status", "text_pages", "allow_copy"],
  downloads: ["method"],
} as const;
export type TabName = keyof typeof TABS;
export const TAB_NAMES = Object.keys(TABS) as TabName[];

/** The full header row a tab should have: its first columns, then the ones added later. */
export function expectedColumns(tab: TabName): string[] {
  return [...TABS[tab], ...((EXTRA_COLS as Record<string, readonly string[]>)[tab] ?? [])];
}

/** Header names to write into row 1 of a tab, starting at column `from` (1 = A). */
export interface HeaderCells { tab: string; from: number; names: string[] }
/** What updating a sheet needs from it. Nothing here can read or write a data row. */
export interface SheetAdmin {
  /** Titles of the tabs that exist. */
  tabs(): Promise<string[]>;
  /** Row 1 of each of these (existing) tabs, in one read. */
  headerRows(tabs: string[]): Promise<Record<string, string[]>>;
  createTabs(tabs: string[]): Promise<void>;
  writeHeaders(cells: HeaderCells[]): Promise<void>;
}

export interface TabStatus {
  tab: TabName;
  exists: boolean;
  /** row 1 as it is in the sheet (trailing empty cells left out) */
  columns: string[];
  /** expected columns that are not in row 1 */
  missing: string[];
  /** expected columns that are in row 1, but not where the app looks for them */
  misplaced: string[];
}
export type Change = { kind: "tab"; tab: TabName } | { kind: "column"; tab: TabName; column: string };

function statusOf(tab: TabName, exists: boolean, row: string[]): TabStatus {
  const columns = row.map((c) => String(c ?? "").trim());
  while (columns.length && !columns[columns.length - 1]) columns.pop();
  const want = expectedColumns(tab);
  return {
    tab, exists, columns,
    missing: want.filter((h) => !columns.includes(h)),
    misplaced: want.filter((h, i) => columns.includes(h) && columns[i] !== h),
  };
}

/** Every expected tab: whether it exists, its header row and what is missing. Two reads. */
export async function sheetStatus(s: SheetAdmin): Promise<TabStatus[]> {
  const have = new Set(await s.tabs());
  const present = TAB_NAMES.filter((t) => have.has(t));
  const rows = present.length ? await s.headerRows(present) : {};
  return TAB_NAMES.map((t) => statusOf(t, have.has(t), rows[t] ?? []));
}

/**
 * Creates the missing tabs (with their header row) and appends the missing header names at the end of row 1.
 * Two reads, then at most two writes. Running it again changes nothing. Returns what changed and the new status.
 */
export async function updateSheet(s: SheetAdmin): Promise<{ changes: Change[]; status: TabStatus[] }> {
  const before = await sheetStatus(s);
  const create = before.filter((t) => !t.exists).map((t) => t.tab);
  const cells: HeaderCells[] = [];
  const added: Change[] = [];
  for (const t of before) {
    if (!t.exists) {
      cells.push({ tab: t.tab, from: 1, names: expectedColumns(t.tab) });
    } else if (t.missing.length) {
      // only after the last header there is: nothing already in row 1 moves
      cells.push({ tab: t.tab, from: t.columns.length + 1, names: t.missing });
      for (const column of t.missing) added.push({ kind: "column", tab: t.tab, column });
    }
  }
  const changes: Change[] = [...create.map((tab): Change => ({ kind: "tab", tab })), ...added];
  if (create.length) await s.createTabs(create);
  if (cells.length) await s.writeHeaders(cells);
  const status = before.map((t) => (t.exists ? statusOf(t.tab, true, [...t.columns, ...t.missing]) : statusOf(t.tab, true, expectedColumns(t.tab))));
  return { changes, status };
}

/** 1 -> A, 27 -> AA */
function colLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** The real Google Sheet. `retry` wraps every API call (the app passes its quota-aware retry). */
export function googleSheetAdmin(api: sheets_v4.Sheets, spreadsheetId: string, retry: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()): SheetAdmin {
  return {
    async tabs() {
      const meta = await retry(() => api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }));
      return (meta.data.sheets ?? []).map((x) => x.properties?.title ?? "").filter(Boolean);
    },
    async headerRows(tabs) {
      const res = await retry(() => api.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((t) => `${t}!1:1`) }));
      return Object.fromEntries(tabs.map((t, i) => [t, (res.data.valueRanges?.[i]?.values?.[0] ?? []).map((c) => String(c ?? ""))]));
    },
    async createTabs(tabs) {
      await retry(() => api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: tabs.map((title) => ({ addSheet: { properties: { title } } })) } }));
    },
    async writeHeaders(cells) {
      // RAW: header names are stored as typed text. Each range is a stretch of row 1 only.
      await retry(() => api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: cells.map((c) => ({ range: `${c.tab}!${colLetter(c.from)}1:${colLetter(c.from + c.names.length - 1)}1`, values: [c.names] })) },
      }));
    },
  };
}
