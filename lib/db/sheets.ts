import "server-only";
import { google, type sheets_v4 } from "googleapis";
import { requireEnv } from "../config";
import { expectedColumns, googleSheetAdmin, TAB_NAMES, type SheetAdmin } from "../sheet-schema";
import { fakeSheetsUrl } from "./backend";
import { MissingTabError, SheetsUnavailableError, type SheetsProblem } from "./errors";
import type { Table, TabName } from "./table";

// The real Google Sheet. Three rules keep the site fast and alive whatever the sheet or Google do:
//  1. Only tabs that exist are ever requested. Google fails a WHOLE batchGet (400 "Unable to parse range") when one
//     range names a missing tab, so the tab list is read first (cached) and a missing optional tab is just "no data".
//  2. Columns are found by their header NAME (row 1), never by position: the app works whatever their order, and
//     columns it does not know are ignored on reads and kept as they are on writes.
//  3. Every call has an 8-second budget, retries (429, 5xx) included. After a timeout or an exhausted retry, calls
//     fail at once for a few seconds instead of piling up: callers then use the data they already had, or show an
//     error with "Reintentar". googleapis' own retries are off, so one call is never more than a handful of requests.

let client: sheets_v4.Sheets | null = null;
function api(): sheets_v4.Sheets {
  if (client) return client;
  const fake = fakeSheetsUrl();
  if (fake) return (client = google.sheets({ version: "v4", rootUrl: `${fake.replace(/\/$/, "")}/` }));
  const auth = new google.auth.JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // Env vars store newlines as the two characters \n
    key: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  client = google.sheets({ version: "v4", auth });
  return client;
}
const sheetId = () => (fakeSheetsUrl() ? "fake" : requireEnv("SHEET_ID"));

// ---- one call: budget, retries, and a short pause after Google failed ----
export const SHEETS_TIMEOUT_MS = 8_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const PAUSE_MS: Record<SheetsProblem, number> = { timeout: 15_000, quota: 20_000, error: 10_000 };
type Opts = { timeout: number; signal: AbortSignal; retry: false };
const g = globalThis as unknown as { __sheetsPause?: { until: number; problem: SheetsProblem; since: number } };
const pause = (g.__sheetsPause ??= { until: 0, problem: "error", since: 0 });
const statusOf = (e: unknown): number => {
  const x = e as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const v = x?.status ?? x?.response?.status ?? x?.code;
  return typeof v === "number" ? v : /^\d{3}$/.test(String(v)) ? Number(v) : 0;
};
const isRangeError = (e: unknown) => statusOf(e) === 400 && /Unable to parse range/i.test(String((e as Error)?.message ?? ""));
function stop(problem: SheetsProblem, cause: unknown): never {
  const now = Date.now();
  if (pause.until < now) console.warn(`[sheets] Google Sheets ${problem === "timeout" ? `did not answer within ${SHEETS_TIMEOUT_MS / 1000} s` : problem === "quota" ? "is over its quota (429)" : "failed"}: calls are paused for ${PAUSE_MS[problem] / 1000} s and pages use the data they already have.`);
  pause.until = now + PAUSE_MS[problem];
  pause.problem = problem;
  pause.since = pause.since || now;
  throw new SheetsUnavailableError(problem, PAUSE_MS[problem], { cause });
}
async function call<T>(fn: (o: Opts) => Promise<T>): Promise<T> {
  if (Date.now() < pause.until) throw new SheetsUnavailableError(pause.problem, pause.until - Date.now());
  const deadline = Date.now() + SHEETS_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left < 250) stop("timeout", null);
    const signal = AbortSignal.timeout(left);
    try {
      const out = await fn({ timeout: left, signal, retry: false });
      pause.since = 0;
      return out;
    } catch (e) {
      if (signal.aborted || Date.now() >= deadline) stop("timeout", e);
      const status = statusOf(e);
      if (status && !RETRY_STATUS.has(status)) throw e; // 400, 403, 404...: retrying cannot help
      const wait = 400 * 2 ** attempt + Math.random() * 200; // 0.4 s, 0.8 s, 1.6 s, 3.2 s
      if (attempt >= 4 || Date.now() + wait + 500 > deadline) stop(status === 429 ? "quota" : "error", e);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
/** Whether calls are paused after a failure, and since when (for /api/health). */
export const sheetsPause = () => ({ paused: Date.now() < pause.until, problem: pause.problem, retryInMs: Math.max(0, pause.until - Date.now()), since: pause.since });

// ---- the tab list and each tab's header row (cached; also refreshed by every full-tab read) ----
interface TabInfo { gid: number; header: string[]; headerAt: number }
interface Meta { at: number; tabs: Map<string, TabInfo> }
const META_MS = 5 * 60_000;
const HEADER_FRESH_MS = 60_000; // a write without a read before it looks the header up again when older than this
const m = globalThis as unknown as { __sheetsMeta?: { meta: Meta | null; loading: Promise<Meta> | null; retryAt: number } };
const metaStore = (m.__sheetsMeta ??= { meta: null, loading: null, retryAt: 0 });
const clean = (row: unknown[] | undefined) => {
  const out = (row ?? []).map((c) => String(c ?? "").trim());
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
};
async function loadMeta(): Promise<Meta> {
  const res = await call((o) => api().spreadsheets.get({ spreadsheetId: sheetId(), fields: "sheets.properties(sheetId,title)" }, o));
  const tabs = new Map<string, TabInfo>();
  for (const s of res.data.sheets ?? []) {
    const title = s.properties?.title;
    if (title && s.properties?.sheetId != null) tabs.set(title, { gid: s.properties.sheetId, header: [], headerAt: 0 });
  }
  const known = TAB_NAMES.filter((t) => tabs.has(t));
  if (known.length) {
    const hr = await call((o) => api().spreadsheets.values.batchGet({ spreadsheetId: sheetId(), ranges: known.map((t) => `${t}!1:1`) }, o));
    known.forEach((t, i) => { const info = tabs.get(t)!; info.header = clean(hr.data.valueRanges?.[i]?.values?.[0]); info.headerAt = Date.now(); });
  }
  return { at: Date.now(), tabs };
}
/** The tab list and header rows. Cached 5 minutes; when a refresh fails the last good copy is used (and retried soon). */
async function getMeta(force = false): Promise<Meta> {
  const have = metaStore.meta;
  if (!force && have && (Date.now() - have.at < META_MS || Date.now() < metaStore.retryAt)) return have;
  metaStore.loading ??= loadMeta().then((x) => (metaStore.meta = x)).finally(() => { metaStore.loading = null; });
  try {
    return await metaStore.loading;
  } catch (e) {
    if (have && !force) { metaStore.retryAt = Date.now() + 15_000; return have; }
    throw e;
  }
}
function noteHeader(tab: string, header: string[]) {
  const info = metaStore.meta?.tabs.get(tab);
  if (info) { info.header = header; info.headerAt = Date.now(); }
}
/** After "Actualizar base de datos" changed tabs or row 1: look everything up again on the next call. */
export function forgetHeaders() {
  metaStore.meta = null;
  metaStore.retryAt = 0;
}
/** Tests only (e2e/resilience.mjs, against the fake API): forget everything, like a brand-new server instance. */
export function resetSheetsForTests(keepTabList = false) {
  if (!keepTabList) forgetHeaders();
  pause.until = 0;
  pause.since = 0;
}
/** Tabs and row 1 of the real sheet, for Mantenimiento (same budget and retries as everything else). */
export const sheetsAdmin = (): SheetAdmin => googleSheetAdmin(api(), sheetId(), (fn) => call((o) => fn(o)));

/** For /api/health: reads the tab list and header rows now (2 requests), timed. */
export async function probeSheets(): Promise<{ ms: number; tabs: string[]; headers: Record<string, string[]> }> {
  const t0 = Date.now();
  const meta = await getMeta(true);
  return { ms: Date.now() - t0, tabs: [...meta.tabs.keys()], headers: Object.fromEntries([...meta.tabs.entries()].map(([k, v]) => [k, v.header])) };
}

// ---- columns by name ----
/** 1 -> A, 27 -> AA */
function colLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
/** For each of the app's columns of `tab` (sheet-schema order), where it is in the sheet (-1: not there). */
const mapOf = (tab: string, header: string[]) => expectedColumns(tab as TabName).map((c) => header.indexOf(c));
const toLogical = (map: number[], row: string[]) => map.map((p) => (p >= 0 ? row[p] ?? "" : ""));
/** The app's row as a sheet row: known columns from `logical`, unknown ones kept from `base` (or empty). */
function toPhysical(map: number[], width: number, logical: string[], base: string[] = []): string[] {
  const out = base.slice(0, width);
  while (out.length < width) out.push("");
  map.forEach((p, i) => { if (p >= 0) out[p] = String(logical[i] ?? ""); });
  return out;
}
interface Read { header: string[]; map: number[]; width: number; physical: string[][]; logical: string[][] }
function shape(tab: string, values: unknown[][] | undefined | null): Read {
  const [first, ...rest] = values ?? [];
  const header = clean(first);
  if (!header.length) throw new MissingTabError(tab);
  noteHeader(tab, header);
  const map = mapOf(tab, header);
  const width = header.length;
  const physical = rest.map((r) => { const out = (r ?? []).map((c) => String(c ?? "")); while (out.length < width) out.push(""); return out; });
  return { header, map, width, physical, logical: physical.map((r) => toLogical(map, r)) };
}
/** The whole tab, header included, in ONE request (the header always matches the rows). */
async function readTab(tab: string): Promise<Read> {
  try {
    const res = await call((o) => api().spreadsheets.values.get({ spreadsheetId: sheetId(), range: tab }, o));
    return shape(tab, res.data.values as unknown[][] | undefined);
  } catch (e) {
    if (isRangeError(e)) { forgetHeaders(); throw new MissingTabError(tab); }
    throw e;
  }
}
/** Header of a tab for a write that reads nothing before: the cached one when recent, else row 1 again (1 request). */
async function headerFor(tab: string): Promise<{ map: number[]; width: number }> {
  const info = (await getMeta()).tabs.get(tab) ?? (await getMeta(true)).tabs.get(tab);
  if (!info) throw new MissingTabError(tab);
  if (Date.now() - info.headerAt > HEADER_FRESH_MS) {
    const res = await call((o) => api().spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!1:1` }, o));
    info.header = clean(res.data.values?.[0]);
    info.headerAt = Date.now();
  }
  if (!info.header.length) throw new MissingTabError(tab);
  return { map: mapOf(tab, info.header), width: info.header.length };
}
async function gidOf(tab: string): Promise<number> {
  const info = (await getMeta()).tabs.get(tab) ?? (await getMeta(true)).tabs.get(tab);
  if (!info) throw new MissingTabError(tab);
  return info.gid;
}

// ---- the Table ----
async function appendPhysical(tab: string, values: string[][]) {
  await call((o) => api().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tab}!A:A`,
    valueInputOption: "RAW", // RAW keeps hashes/ids as text (no number coercion) and never evaluates a formula
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  }, o));
}
async function appendRows(tab: string, rows: string[][]) {
  if (!rows.length) return;
  const { map, width } = await headerFor(tab);
  await appendPhysical(tab, rows.map((r) => toPhysical(map, width, r)));
}
const rangeOf = (tab: string, r: Read, i: number) => `${tab}!A${i + 2}:${colLetter(r.width)}${i + 2}`; // row 1 is the header
async function deleteRows(tab: string, idx: number[]): Promise<number> {
  if (!idx.length) return 0;
  const gid = await gidOf(tab);
  // Delete from the bottom up so indexes stay valid.
  const requests = [...idx].sort((a, b) => b - a).map((i) => ({ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }));
  await call((o) => api().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests } }, o));
  return idx.length;
}
const matches = (r: string[], match: [number, string][]) => match.every(([c, v]) => r[c] === v);

export const sheetsTable: Table = {
  async list(tab) {
    return (await readTab(tab)).logical;
  },
  async listMany(tabs) {
    // Only tabs that exist: one missing range would make Google fail the whole request.
    const read = async (names: string[]) => {
      if (!names.length) return {};
      const res = await call((o) => api().spreadsheets.values.batchGet({ spreadsheetId: sheetId(), ranges: names }, o));
      const out: Record<string, string[][]> = {};
      names.forEach((t, i) => {
        try { out[t] = shape(t, res.data.valueRanges?.[i]?.values as unknown[][] | undefined).logical; } catch { /* no header row: like a missing tab */ }
      });
      return out;
    };
    const present = (meta: Meta) => tabs.filter((t) => meta.tabs.has(t));
    try {
      return await read(present(await getMeta()));
    } catch (e) {
      if (!isRangeError(e)) throw e;
      // A tab went away since the list was read: read the list again and retry; still failing, each tab on its own.
      forgetHeaders();
      const names = present(await getMeta(true));
      try {
        return await read(names);
      } catch (e2) {
        if (!isRangeError(e2)) throw e2;
        const parts = await Promise.all(names.map((t) => read([t]).catch((x) => { if (isRangeError(x)) return {}; throw x; })));
        return Object.assign({}, ...parts) as Record<string, string[][]>;
      }
    }
  },
  async append(tab, row) {
    await appendRows(tab, [row]);
  },
  async appendMany(tab, rows) {
    await appendRows(tab, rows);
  },
  async modifyWhere(tab, match, fn) {
    const r = await readTab(tab);
    const i = r.logical.findIndex((x) => matches(x, match));
    if (i < 0) return null;
    const next = fn([...r.logical[i]]);
    if (!next) return null;
    const row = toPhysical(r.map, r.width, next, r.physical[i]);
    await call((o) => api().spreadsheets.values.update({ spreadsheetId: sheetId(), range: rangeOf(tab, r, i), valueInputOption: "RAW", requestBody: { values: [row] } }, o));
    return toLogical(r.map, row);
  },
  async upsertMany(tab, keyCols, rows) {
    if (!rows.length) return;
    const r = await readTab(tab);
    const data: { range: string; values: string[][] }[] = [];
    const fresh: string[][] = [];
    for (const row of rows) {
      const i = r.logical.findIndex((x) => keyCols.every((c) => x[c] === row[c]));
      if (i < 0) fresh.push(toPhysical(r.map, r.width, row));
      else data.push({ range: rangeOf(tab, r, i), values: [toPhysical(r.map, r.width, row, r.physical[i])] });
    }
    if (data.length) await call((o) => api().spreadsheets.values.batchUpdate({ spreadsheetId: sheetId(), requestBody: { valueInputOption: "RAW", data } }, o));
    if (fresh.length) await appendPhysical(tab, fresh);
  },
  async applyRows(tab, removeIds, add) {
    if (!removeIds.length && !add.length) return;
    const requests: sheets_v4.Schema$Request[] = [];
    const gid = await gidOf(tab);
    let cols: { map: number[]; width: number };
    if (removeIds.length) {
      const gone = new Set(removeIds);
      const r = await readTab(tab);
      cols = r;
      r.logical.map((x, i) => (gone.has(x[0]) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a)
        .forEach((i) => requests.push({ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }));
    } else {
      cols = await headerFor(tab);
    }
    if (add.length) {
      // stringValue is always literal text: a label like =IMPORTXML(...) is never evaluated as a formula
      requests.push({ appendCells: { sheetId: gid, fields: "userEnteredValue", rows: add.map((x) => ({ values: toPhysical(cols.map, cols.width, x).map((v) => ({ userEnteredValue: { stringValue: v } })) })) } });
    }
    if (requests.length) await call((o) => api().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests } }, o));
  },
  async deleteMatching(tab, match) {
    const r = await readTab(tab);
    return deleteRows(tab, r.logical.map((x, i) => (matches(x, match) ? i : -1)).filter((i) => i >= 0));
  },
  async updateById(tab, id, row) {
    const r = await readTab(tab);
    const i = r.logical.findIndex((x) => x[0] === id);
    if (i < 0) return false;
    await call((o) => api().spreadsheets.values.update({ spreadsheetId: sheetId(), range: rangeOf(tab, r, i), valueInputOption: "RAW", requestBody: { values: [toPhysical(r.map, r.width, row, r.physical[i])] } }, o));
    return true;
  },
  async hasColumn(tab, _index, name) {
    // by name, wherever the column is. False when the sheet cannot be read right now (the feature waits).
    try { return (await getMeta()).tabs.get(tab)?.header.includes(name) ?? false; } catch { return false; }
  },
  async deleteWhere(tab, col, value) {
    const r = await readTab(tab);
    return deleteRows(tab, r.logical.map((x, i) => (x[col] === value ? i : -1)).filter((i) => i >= 0));
  },
};
