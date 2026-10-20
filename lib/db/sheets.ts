import "server-only";
import { google, type sheets_v4 } from "googleapis";
import { requireEnv } from "../config";
import { TABS, type Table, type TabName } from "./table";

let client: sheets_v4.Sheets | null = null;
function api(): sheets_v4.Sheets {
  if (client) return client;
  const auth = new google.auth.JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // Env vars store newlines as the two characters \n
    key: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  client = google.sheets({ version: "v4", auth });
  return client;
}
const sheetId = () => requireEnv("SHEET_ID");

/** Google answers 429 (quota) and the odd 5xx: wait 0.5 s, 1 s, 2 s, 4 s, 8 s (+ jitter) and try again. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = Number((e as { code?: number; status?: number }).code ?? (e as { status?: number }).status);
      if (attempt >= 5 || !RETRY_STATUS.has(status)) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
    }
  }
}
const lastCol = (tab: TabName) => String.fromCharCode(64 + TABS[tab].length);

async function readAll(tab: string): Promise<string[][]> {
  const res = await call(() => api().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A2:${lastCol(tab as TabName)}`,
  }));
  return pad(tab, res.data.values ?? []);
}
function pad(tab: string, values: unknown[][]): string[][] {
  return values.map((r) => {
    const out = r.map((c) => String(c ?? ""));
    while (out.length < TABS[tab as TabName].length) out.push("");
    return out;
  });
}

const gids = new Map<string, number>();
async function gidOf(tab: string): Promise<number> {
  const known = gids.get(tab);
  if (known != null) return known;
  const meta = await call(() => api().spreadsheets.get({
    spreadsheetId: sheetId(),
    fields: "sheets.properties(sheetId,title)",
  }));
  const s = meta.data.sheets?.find((x) => x.properties?.title === tab);
  if (s?.properties?.sheetId == null) throw new Error("tab missing");
  gids.set(tab, s.properties.sheetId);
  return s.properties.sheetId;
}

export const sheetsTable: Table = {
  list: readAll,
  async append(tab, row) {
    await this.appendMany(tab, [row]);
  },
  async appendMany(tab, rows) {
    if (!rows.length) return;
    await call(() => api().spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${tab}!A:A`,
      valueInputOption: "RAW", // RAW keeps hashes/ids as text (no number coercion)
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    }));
  },
  async listMany(tabs) {
    const res = await call(() => api().spreadsheets.values.batchGet({
      spreadsheetId: sheetId(),
      ranges: tabs.map((t) => `${t}!A2:${lastCol(t as TabName)}`),
    }));
    const out: Record<string, string[][]> = {};
    tabs.forEach((t, i) => { out[t] = pad(t, res.data.valueRanges?.[i]?.values ?? []); });
    return out;
  },
  async modifyWhere(tab, match, fn) {
    const rows = await readAll(tab);
    const i = rows.findIndex((r) => match.every(([c, v]) => r[c] === v));
    if (i < 0) return null;
    const next = fn([...rows[i]]);
    if (!next) return null;
    const n = i + 2;
    await call(() => api().spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${tab}!A${n}:${lastCol(tab as TabName)}${n}`,
      valueInputOption: "RAW",
      requestBody: { values: [next] },
    }));
    return next;
  },
  async upsertMany(tab, keyCols, rows) {
    if (!rows.length) return;
    const have = await readAll(tab);
    const data: { range: string; values: string[][] }[] = [];
    const fresh: string[][] = [];
    for (const row of rows) {
      const i = have.findIndex((r) => keyCols.every((c) => r[c] === row[c]));
      if (i < 0) { fresh.push(row); continue; }
      const n = i + 2;
      data.push({ range: `${tab}!A${n}:${lastCol(tab as TabName)}${n}`, values: [row] });
    }
    if (data.length) {
      await call(() => api().spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId(),
        requestBody: { valueInputOption: "RAW", data },
      }));
    }
    if (fresh.length) await this.appendMany(tab, fresh);
  },
  async applyRows(tab, removeIds, add) {
    if (!removeIds.length && !add.length) return;
    const requests: sheets_v4.Schema$Request[] = [];
    if (removeIds.length) {
      const gone = new Set(removeIds);
      const rows = await readAll(tab);
      const gid = await gidOf(tab);
      rows.map((r, i) => (gone.has(r[0]) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a)
        .forEach((i) => requests.push({ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }));
    }
    if (add.length) {
      // stringValue is always literal text: a label like =IMPORTXML(...) is never evaluated as a formula
      requests.push({ appendCells: { sheetId: await gidOf(tab), fields: "userEnteredValue", rows: add.map((r) => ({ values: r.map((v) => ({ userEnteredValue: { stringValue: v } })) })) } });
    }
    if (requests.length) await call(() => api().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests } }));
  },
  async deleteMatching(tab, match) {
    const rows = await readAll(tab);
    const idx = rows.map((r, i) => (match.every(([c, v]) => r[c] === v) ? i : -1)).filter((i) => i >= 0);
    return deleteRows(tab, idx);
  },
  async updateById(tab, id, row) {
    const rows = await readAll(tab);
    const i = rows.findIndex((r) => r[0] === id);
    if (i < 0) return false;
    const n = i + 2;
    await call(() => api().spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${tab}!A${n}:${lastCol(tab as TabName)}${n}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    }));
    return true;
  },
  async deleteWhere(tab, col, value) {
    const rows = await readAll(tab);
    return deleteRows(tab, rows.map((r, i) => (r[col] === value ? i : -1)).filter((i) => i >= 0));
  },
};

async function deleteRows(tab: string, idx: number[]): Promise<number> {
  if (!idx.length) return 0;
  const gid = await gidOf(tab);
  // Delete from the bottom up so indexes stay valid.
  const requests = [...idx]
    .sort((a, b) => b - a)
    .map((i) => ({
      deleteDimension: {
        range: { sheetId: gid, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 },
      },
    }));
  await call(() => api().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests } }));
  return idx.length;
}
