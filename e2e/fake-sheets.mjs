// A fake Google Sheets API (the v4 calls this app makes), for tests of the REAL Google adapter (lib/db/sheets.ts).
// It behaves like Google where the in-app mock does not:
//  - a read whose range names a tab that does not exist fails the WHOLE request: 400 "Unable to parse range"
//    (values.batchGet included, even when every other range is fine)
//  - optional slowness (every response delayed), 429 rate limits (forced, or a per-minute read quota like Google's)
//  - columns in any order, and columns the app does not know (FAKE_SHUFFLE=1)
//
//   node e2e/fake-sheets.mjs                       (port 3999; FAKE_SHEETS_PORT to change it)
//   FAKE_SHEETS_URL=http://localhost:3999 DATA_BACKEND=mock npx next dev -p 3100
//
// Seeding (once, at start): the rows of .data/mock-sheet.json, so the books match the mock page images in .data/blobs.
//   MOCK_MISSING_TABS / MOCK_MISSING_COLUMNS   like the mock: tabs left out; a column and the ones after it left out
//   FAKE_SHUFFLE=1                             every tab's columns in a random order plus an unknown column "nota_libre"
// Every change to data rows is written back to .data/mock-sheet.json in the app's column order, so tests that read
// that file work the same with this server. Control (JSON over HTTP):
//   POST /__control {delayMs, fail429, readQuotaPerMin, dropTabs, reseed:{missingTabs, missingColumns, shuffle}}
//   GET  /__stats  (requests by kind and status)   POST /__stats/reset   GET /__dump (the tabs as stored)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { expectedColumns, TABS } from "../lib/sheet-schema.ts";

export const UNKNOWN_COLUMN = "nota_libre";
const FILE = process.env.FAKE_SHEETS_FILE || path.join(process.cwd(), ".data", "mock-sheet.json");
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function createFakeSheets() {
  /** title -> { gid, rows } (rows[0] is the header row, every cell a string) */
  let tabs = new Map();
  let hidden = {}; // rows of tabs left out at seeding: written back to the file untouched
  let nextGid = 1000;
  const ctl = { delayMs: 0, fail429: 0, readQuotaPerMin: 0 };
  const window = [];
  let stats;
  const resetStats = () => { stats = { total: 0, reads: 0, writes: 0, status: {}, kinds: {}, log: [] }; };
  resetStats();

  function seed({ missingTabs = list(process.env.MOCK_MISSING_TABS), missingColumns = list(process.env.MOCK_MISSING_COLUMNS), shuffle = process.env.FAKE_SHUFFLE === "1" } = {}) {
    let logical = {};
    try { logical = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* start empty */ }
    if (!logical.admins?.length) logical.admins = [["admin", bcrypt.hashSync(process.env.MOCK_ADMIN_PASSWORD || "admin123", 10)]];
    let r = 20260424; // deterministic "random" order
    const rand = (n) => { r = (r * 1103515245 + 12345) % 2147483648; return r % n; };
    tabs = new Map(); hidden = {};
    for (const tab of Object.keys(TABS)) {
      if (missingTabs.includes(tab)) { hidden[tab] = logical[tab] ?? []; continue; }
      const all = expectedColumns(tab);
      const cut = all.findIndex((c) => missingColumns.includes(c));
      let header = cut < 0 ? [...all] : all.slice(0, cut);
      if (shuffle) {
        for (let i = header.length - 1; i > 0; i--) { const j = rand(i + 1); [header[i], header[j]] = [header[j], header[i]]; }
        header.splice(rand(header.length + 1), 0, UNKNOWN_COLUMN);
      }
      const rows = (logical[tab] ?? []).map((row, n) => header.map((h) => (h === UNKNOWN_COLUMN ? `keep-${tab}-${n}` : String(row[all.indexOf(h)] ?? ""))));
      tabs.set(tab, { gid: nextGid++, rows: [header, ...rows] });
    }
  }
  /** The data rows back to the file, in the app's column order (what the in-app mock stores). */
  function persist() {
    const out = {};
    for (const tab of Object.keys(TABS)) {
      const t = tabs.get(tab);
      if (!t) { out[tab] = hidden[tab] ?? []; continue; }
      const [header = [], ...rows] = t.rows;
      const at = expectedColumns(tab).map((c) => header.indexOf(c));
      out[tab] = rows.filter((row) => row.some((c) => c !== "")).map((row) => at.map((i) => (i >= 0 ? row[i] ?? "" : "")));
    }
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(out)); } catch { /* memory stays the truth */ }
  }

  class HttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const badRange = (range) => new HttpError(400, `Unable to parse range: ${range}`, "INVALID_ARGUMENT");
  function parseRange(range) {
    const bang = range.lastIndexOf("!");
    const title = (bang < 0 ? range : range.slice(0, bang)).replace(/^'(.*)'$/, "$1");
    const tab = tabs.get(title);
    if (!tab) throw badRange(range);
    const a1 = bang < 0 ? "" : range.slice(bang + 1);
    const m = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(a1);
    if (!m) throw badRange(range);
    const [, c1, r1, c2, r2] = m;
    const single = m[3] === undefined;
    return {
      tab, title,
      col1: c1 ? colIndex(c1) : 0, row1: r1 ? Number(r1) : 1,
      col2: c2 ? colIndex(c2) : single && c1 ? colIndex(c1) : Infinity,
      row2: r2 ? Number(r2) : single && r1 ? Number(r1) : Infinity,
    };
  }
  function readRange(range) {
    const p = parseRange(range);
    const out = [];
    for (let i = p.row1 - 1; i < Math.min(p.tab.rows.length, p.row2); i++) {
      const row = (p.tab.rows[i] ?? []).slice(p.col1, p.col2 === Infinity ? undefined : p.col2 + 1);
      while (row.length && row[row.length - 1] === "") row.pop();
      out.push(row);
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out.length ? { range, majorDimension: "ROWS", values: out } : { range, majorDimension: "ROWS" };
  }
  let dirty = false;
  function writeRange(range, values) {
    const p = parseRange(range);
    values.forEach((vals, i) => {
      const n = p.row1 - 1 + i;
      while (p.tab.rows.length <= n) p.tab.rows.push([]);
      const row = p.tab.rows[n];
      vals.forEach((v, j) => { const c = p.col1 + j; while (row.length <= c) row.push(""); row[c] = String(v ?? ""); });
      if (n > 0) dirty = true;
    });
    return { updatedRange: range, updatedRows: values.length };
  }
  const trimEnd = (rows) => { while (rows.length > 1 && !rows[rows.length - 1].some((c) => c !== "")) rows.pop(); };
  function append(tab, values) {
    trimEnd(tab.rows);
    if (!tab.rows.length) tab.rows.push([]);
    for (const v of values) tab.rows.push(v.map((c) => String(c ?? "")));
    dirty = true;
  }
  function batchUpdate(requests) {
    const replies = [];
    for (const rq of requests ?? []) {
      if (rq.addSheet) {
        const title = rq.addSheet.properties?.title;
        if (tabs.has(title)) throw new HttpError(400, `Invalid requests[0].addSheet: A sheet with the name "${title}" already exists. Please enter another name.`, "INVALID_ARGUMENT");
        const gid = nextGid++;
        tabs.set(title, { gid, rows: [] });
        replies.push({ addSheet: { properties: { sheetId: gid, title } } });
      } else if (rq.deleteDimension) {
        const { sheetId, startIndex, endIndex } = rq.deleteDimension.range;
        const tab = [...tabs.values()].find((t) => t.gid === sheetId);
        if (!tab) throw new HttpError(400, `No grid with id: ${sheetId}`, "INVALID_ARGUMENT");
        tab.rows.splice(startIndex, endIndex - startIndex);
        dirty = true; replies.push({});
      } else if (rq.appendCells) {
        const tab = [...tabs.values()].find((t) => t.gid === rq.appendCells.sheetId);
        if (!tab) throw new HttpError(400, `No grid with id: ${rq.appendCells.sheetId}`, "INVALID_ARGUMENT");
        append(tab, (rq.appendCells.rows ?? []).map((r) => (r.values ?? []).map((v) => v.userEnteredValue?.stringValue ?? "")));
        replies.push({});
      } else throw new HttpError(400, "Unsupported request in the fake", "INVALID_ARGUMENT");
    }
    return { replies };
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const s = Buffer.concat(chunks).toString("utf8");
    return s ? JSON.parse(s) : {};
  }
  const send = (res, code, obj) => { if (res.writableEnded || res.destroyed) return; res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  async function handle(req, res) {
    const url = new URL(req.url, "http://fake");
    if (url.pathname.startsWith("/__")) return control(req, res, url);
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
    if (!m) return send(res, 404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
    const rest = m[2];
    const read = req.method === "GET";
    const kind = read ? (rest === "" ? "meta" : rest === "/values:batchGet" ? "batchGet" : "get") : rest === ":batchUpdate" ? "batchUpdate" : rest === "/values:batchUpdate" ? "valuesBatchUpdate" : rest.endsWith(":append") ? "append" : "update";
    const payload = read ? null : await body(req).catch(() => ({}));
    stats.total++; stats[read ? "reads" : "writes"]++; stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    const detail = read ? (url.searchParams.getAll("ranges").join(",") || decodeURIComponent(rest)) : decodeURIComponent(rest);
    const done = (code, obj) => { stats.status[code] = (stats.status[code] ?? 0) + 1; stats.log.push(`${Date.now()} ${req.method} ${kind} ${code} ${detail}`.slice(0, 300)); if (stats.log.length > 400) stats.log.shift(); send(res, code, obj); };
    if (ctl.delayMs) await sleep(ctl.delayMs);
    if (ctl.fail429 > 0) { ctl.fail429--; return done(429, { error: { code: 429, message: "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'", status: "RESOURCE_EXHAUSTED" } }); }
    if (read && ctl.readQuotaPerMin) {
      const now = Date.now();
      while (window.length && now - window[0] > 60_000) window.shift();
      window.push(now); // Google counts the request even when it is refused
      if (window.length > ctl.readQuotaPerMin) return done(429, { error: { code: 429, message: "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'", status: "RESOURCE_EXHAUSTED" } });
    }
    try {
      dirty = false;
      let out;
      if (kind === "meta") {
        out = { spreadsheetId: m[1], sheets: [...tabs.entries()].map(([title, t], index) => ({ properties: { sheetId: t.gid, title, index, sheetType: "GRID", gridProperties: { rowCount: Math.max(1000, t.rows.length), columnCount: 26 } } })) };
      } else if (kind === "batchGet") {
        const ranges = url.searchParams.getAll("ranges");
        out = { spreadsheetId: m[1], valueRanges: ranges.map(readRange) }; // one bad range fails everything, like Google
      } else if (kind === "get") {
        out = readRange(decodeURIComponent(rest.replace(/^\/values\//, "")));
      } else if (kind === "append") {
        const range = decodeURIComponent(rest.replace(/^\/values\//, "").replace(/:append$/, ""));
        const p = parseRange(range);
        append(p.tab, payload.values ?? []);
        out = { spreadsheetId: m[1], updates: { updatedRange: range, updatedRows: (payload.values ?? []).length } };
      } else if (kind === "update") {
        out = writeRange(decodeURIComponent(rest.replace(/^\/values\//, "")), payload.values ?? []);
      } else if (kind === "valuesBatchUpdate") {
        for (const d of payload.data ?? []) parseRange(d.range); // all or nothing
        out = { responses: (payload.data ?? []).map((d) => writeRange(d.range, d.values ?? [])) };
      } else {
        out = batchUpdate(payload.requests);
      }
      if (dirty) persist();
      done(200, out);
    } catch (e) {
      done(e.code ?? 500, { error: { code: e.code ?? 500, message: e.message, status: e.status ?? "INTERNAL" } });
    }
  }

  async function control(req, res, url) {
    if (url.pathname === "/__stats" && req.method === "GET") return send(res, 200, stats);
    if (url.pathname === "/__stats/reset") { resetStats(); return send(res, 200, { ok: true }); }
    if (url.pathname === "/__dump") return send(res, 200, Object.fromEntries([...tabs.entries()].map(([k, t]) => [k, t.rows])));
    if (url.pathname === "/__control" && req.method === "POST") {
      const b = await body(req).catch(() => ({}));
      for (const k of ["delayMs", "fail429", "readQuotaPerMin"]) if (b[k] !== undefined) ctl[k] = Number(b[k]) || 0;
      if (b.reseed) seed({ missingTabs: list(b.reseed.missingTabs), missingColumns: list(b.reseed.missingColumns), shuffle: !!b.reseed.shuffle });
      for (const t of list(b.dropTabs)) { const x = tabs.get(t); if (x) { hidden[t] = []; tabs.delete(t); } }
      if (b.resetQuota) window.length = 0;
      return send(res, 200, { ok: true, ...ctl, tabs: [...tabs.keys()] });
    }
    send(res, 404, { error: "unknown control" });
  }

  seed();
  const server = http.createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, { error: { code: 500, message: String(e) } })); });
  return {
    server,
    listen: (port) => new Promise((resolve) => server.listen(port, () => resolve(`http://localhost:${port}`))),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fake = createFakeSheets();
  const url = await fake.listen(Number(process.env.FAKE_SHEETS_PORT) || 3999);
  console.log(`fake Google Sheets API on ${url} (missing tabs: ${process.env.MOCK_MISSING_TABS || "none"}, missing columns: ${process.env.MOCK_MISSING_COLUMNS || "none"}, shuffled: ${process.env.FAKE_SHUFFLE === "1" ? "yes" : "no"})`);
}
