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
const lastCol = (tab: TabName) => String.fromCharCode(64 + TABS[tab].length);

async function readAll(tab: string): Promise<string[][]> {
  const res = await api().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A2:${lastCol(tab as TabName)}`,
  });
  return (res.data.values ?? []).map((r) => {
    const out = r.map((c) => String(c ?? ""));
    while (out.length < TABS[tab as TabName].length) out.push("");
    return out;
  });
}

async function gidOf(tab: string): Promise<number> {
  const meta = await api().spreadsheets.get({
    spreadsheetId: sheetId(),
    fields: "sheets.properties(sheetId,title)",
  });
  const s = meta.data.sheets?.find((x) => x.properties?.title === tab);
  if (s?.properties?.sheetId == null) throw new Error("tab missing");
  return s.properties.sheetId;
}

export const sheetsTable: Table = {
  list: readAll,
  async append(tab, row) {
    await api().spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${tab}!A:A`,
      valueInputOption: "RAW", // RAW keeps hashes/ids as text (no number coercion)
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  },
  async updateById(tab, id, row) {
    const rows = await readAll(tab);
    const i = rows.findIndex((r) => r[0] === id);
    if (i < 0) return false;
    const n = i + 2;
    await api().spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${tab}!A${n}:${lastCol(tab as TabName)}${n}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
    return true;
  },
  async deleteWhere(tab, col, value) {
    const rows = await readAll(tab);
    const idx = rows.map((r, i) => (r[col] === value ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return 0;
    const gid = await gidOf(tab);
    // Delete from the bottom up so indexes stay valid.
    const requests = idx
      .sort((a, b) => b - a)
      .map((i) => ({
        deleteDimension: {
          range: { sheetId: gid, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 },
        },
      }));
    await api().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests } });
    return idx.length;
  },
};

/** Used by scripts/setup-sheet.ts */
export async function ensureTabs(): Promise<string[]> {
  const meta = await api().spreadsheets.get({ spreadsheetId: sheetId(), fields: "sheets.properties.title" });
  const have = new Set(meta.data.sheets?.map((s) => s.properties?.title));
  const created: string[] = [];
  for (const tab of Object.keys(TABS) as TabName[]) {
    if (!have.has(tab)) {
      await api().spreadsheets.batchUpdate({
        spreadsheetId: sheetId(),
        requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
      });
      created.push(tab);
    }
    const head = await api().spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${tab}!A1:${lastCol(tab)}1`,
    });
    if (!head.data.values?.length) {
      await api().spreadsheets.values.update({
        spreadsheetId: sheetId(),
        range: `${tab}!A1:${lastCol(tab)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...TABS[tab]]] },
      });
    }
  }
  return created;
}
