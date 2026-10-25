import "server-only";
import { isMock } from "./config";
import { fakeSheetsUrl, mockTableOn } from "./db/backend";
import { mockSheetAdmin } from "./db/mock";
import { probeSheets, SHEETS_TIMEOUT_MS, sheetsPause } from "./db/sheets";
import { snapshotAge } from "./db/users";
import { expectedColumns, TAB_NAMES, type TabName } from "./sheet-schema";
import { storage } from "./storage";
import { R2_TIMEOUT_MS } from "./storage/r2";

/** Tabs the site cannot work without; the others only hide their feature while missing. */
const REQUIRED: TabName[] = ["books", "access_codes", "admins", "users", "user_books", "progress", "passkeys"];

export interface Health {
  ok: boolean;
  checked_at: string;
  backend: "google" | "mock" | "fake-google";
  sheets: {
    ok: boolean;
    ms: number | null;
    error?: string;
    tabs_found: string[];
    tabs_missing: string[];
    /** columns the app knows that row 1 of an existing tab does not have */
    columns_missing: Record<string, string[]>;
    /** calls paused after Google failed (they resume by themselves) */
    paused?: { problem: string; retry_in_s: number };
  };
  storage: { ok: boolean; ms: number | null; error?: string };
  /** how old the users cache is (s): older than ~45 s means the sheet could not be read lately */
  users_cache_age_s: number | null;
}

const describe = (e: unknown, budget: number): string => {
  const x = e as { name?: string; problem?: string; status?: number; code?: unknown; message?: string };
  const status = Number(x?.status ?? x?.code);
  if (x?.problem === "timeout" || x?.name === "TimeoutError" || x?.name === "AbortError" || x?.name === "StorageUnavailableError") return `No responde en ${budget / 1000} s`;
  if (x?.problem === "quota" || status === 429) return "Límite de peticiones de Google (429): se reintenta solo en unos segundos";
  if (status === 403) return "Sin permiso (403): comparte la hoja con la cuenta de servicio";
  if (status === 404) return "No encontrada (404): revisa el identificador configurado";
  if (/Missing env var/.test(String(x?.message))) return "Falta configuración en las variables de entorno";
  return "No se ha podido conectar";
};

async function checkSheets(): Promise<Health["sheets"]> {
  if (mockTableOn()) {
    // the in-app mock: its simulated row 1 (Mantenimiento's view of it)
    const tabs = await mockSheetAdmin.tabs();
    const rows = await mockSheetAdmin.headerRows(tabs);
    return summarize(0, tabs, rows);
  }
  const pause = sheetsPause();
  if (pause.paused) {
    return { ok: false, ms: null, error: describe({ problem: pause.problem }, SHEETS_TIMEOUT_MS), tabs_found: [], tabs_missing: [], columns_missing: {}, paused: { problem: pause.problem, retry_in_s: Math.ceil(pause.retryInMs / 1000) } };
  }
  try {
    const p = await probeSheets();
    return summarize(p.ms, p.tabs, p.headers);
  } catch (e) {
    return { ok: false, ms: null, error: describe(e, SHEETS_TIMEOUT_MS), tabs_found: [], tabs_missing: [], columns_missing: {} };
  }
}
function summarize(ms: number, tabs: string[], headers: Record<string, string[]>): Health["sheets"] {
  const have = new Set(tabs);
  const tabs_missing = TAB_NAMES.filter((t) => !have.has(t));
  const columns_missing: Record<string, string[]> = {};
  for (const t of TAB_NAMES) {
    if (!have.has(t)) continue;
    const miss = expectedColumns(t).filter((c) => !(headers[t] ?? []).includes(c));
    if (miss.length) columns_missing[t] = miss;
  }
  const broken = REQUIRED.some((t) => !have.has(t));
  return { ok: !broken, ms, ...(broken ? { error: "Faltan pestañas imprescindibles" } : {}), tabs_found: TAB_NAMES.filter((t) => have.has(t)), tabs_missing, columns_missing };
}
async function checkStorage(): Promise<Health["storage"]> {
  const t0 = Date.now();
  try {
    await storage().ping();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: null, error: describe(e, R2_TIMEOUT_MS) };
  }
}

// One check at a time, reused for 30 s (a public URL must not be a way to spend the sheet's quota). The admin's
// "Comprobar de nuevo" checks again, at most every 5 s.
const g = globalThis as unknown as { __health?: { last: Health | null; at: number; running: Promise<Health> | null } };
const state = (g.__health ??= { last: null, at: 0, running: null });
/** After "Actualizar base de datos" (and in tests): the next check runs at once. */
export function forgetHealth() {
  state.last = null;
  state.at = 0;
}
export async function checkHealth(fresh = false): Promise<Health> {
  const age = Date.now() - state.at;
  if (state.last && age < (fresh ? 5_000 : 30_000)) return state.last;
  state.running ??= (async () => {
    const [sheets, store] = await Promise.all([checkSheets(), checkStorage()]);
    const age = snapshotAge();
    const h: Health = {
      ok: sheets.ok && store.ok,
      checked_at: new Date().toISOString(),
      backend: !isMock() ? "google" : fakeSheetsUrl() ? "fake-google" : "mock",
      sheets, storage: store,
      users_cache_age_s: age === null ? null : Math.round(age / 1000),
    };
    state.last = h;
    state.at = Date.now();
    return h;
  })().finally(() => { state.running = null; });
  return state.running;
}
