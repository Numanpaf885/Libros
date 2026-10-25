import "server-only";
import { isMock } from "../config";

/**
 * Tests only: mock mode, but with the REAL Google adapter (lib/db/sheets.ts) talking to the fake Sheets API in
 * e2e/fake-sheets.mjs. Mock mode is refused in production (lib/safety.ts), so this can never reach the live site.
 */
export const fakeSheetsUrl = (): string | null => (isMock() && process.env.FAKE_SHEETS_URL ? process.env.FAKE_SHEETS_URL : null);
/** The in-memory mock table, unless the real adapter is being tested against the fake API. */
export const mockTableOn = (): boolean => isMock() && !fakeSheetsUrl();
