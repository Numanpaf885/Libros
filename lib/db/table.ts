import "server-only";
/**
 * Minimal row store. Rows are string[] in the app's column order (lib/sheet-schema.ts: a tab's columns, then its
 * EXTRA_COLS), header row excluded, whatever the order of the columns in the sheet itself. A column the sheet does not
 * have reads as "" and is not written.
 */
export interface Table {
  list(tab: string): Promise<string[][]>;
  append(tab: string, row: string[]): Promise<void>;
  /** Replace the first row whose column 0 equals id. Returns false if missing. */
  updateById(tab: string, id: string, row: string[]): Promise<boolean>;
  /** Delete all rows whose column `col` equals value. */
  deleteWhere(tab: string, col: number, value: string): Promise<number>;
  /**
   * Several tabs in ONE read request (Sheets values.batchGet). Only tabs that exist are read: a missing tab is absent
   * from the result (never an error), so one missing optional tab cannot break the others.
   */
  listMany(tabs: string[]): Promise<Record<string, string[][]>>;
  /** Several rows in ONE write request. */
  appendMany(tab: string, rows: string[][]): Promise<void>;
  /**
   * Read the first row where every [column, value] pair matches, pass its FRESH values to `fn`, and write back what
   * `fn` returns (null = leave unchanged). One read + one write. Returns the stored row, or null if missing/unchanged.
   */
  modifyWhere(tab: string, match: [number, string][], fn: (row: string[]) => string[] | null): Promise<string[] | null>;
  /** Insert or replace rows by key columns: one read, at most one batched update and one append. */
  upsertMany(tab: string, keyCols: number[], rows: string[][]): Promise<void>;
  /** Delete every row where all [column, value] pairs match. */
  deleteMatching(tab: string, match: [number, string][]): Promise<number>;
  /**
   * Remove the rows whose column 0 is in `removeIds` and append `add`, in ONE write request (one read first when
   * something has to be removed). Text is stored literally (never parsed as a formula).
   */
  applyRows(tab: string, removeIds: string[], add: string[][]): Promise<void>;
  /** Whether column `index` (0-based) of `tab` has the header `name`. Cached for a few minutes; false on any error. */
  hasColumn(tab: string, index: number, name: string): Promise<boolean>;
}

// The tabs, their columns and the columns added later (EXTRA_COLS: a tab only has them once the sheet has been
// updated) live in ONE place, shared with `npm run setup-sheet` and the admin's "Actualizar base de datos".
export { EXTRA_COLS, TABS, type TabName } from "../sheet-schema";
