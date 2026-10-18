/** Minimal row store. Rows are string[] in column order (header row excluded). */
export interface Table {
  list(tab: string): Promise<string[][]>;
  append(tab: string, row: string[]): Promise<void>;
  /** Replace the first row whose column 0 equals id. Returns false if missing. */
  updateById(tab: string, id: string, row: string[]): Promise<boolean>;
  /** Delete all rows whose column `col` equals value. */
  deleteWhere(tab: string, col: number, value: string): Promise<number>;
  /** Several tabs in ONE read request (Sheets values.batchGet). */
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
}

export const TABS = {
  books: ["id", "slug", "title", "description", "page_count", "storage_prefix", "cover_path", "status", "updated_at", "author", "category", "year"],
  access_codes: ["id", "book_id", "code_hash", "label", "created_at", "expires_at", "revoked"],
  admins: ["username", "password_hash"],
  users: ["id", "username", "display_name", "password_hash", "status", "setup_code_hash", "setup_code_expires_at", "setup_attempts", "failed_logins", "locked_until", "session_version", "created_at", "last_login_at"],
  user_books: ["user_id", "book_id", "source", "code_id", "granted_at"],
  progress: ["user_id", "book_id", "page", "updated_at"],
  passkeys: ["id", "user_id", "credential_id", "public_key", "counter", "transports", "label", "created_at", "last_used_at"],
  bookmarks: ["id", "user_id", "book_id", "page", "label", "created_at"],
} as const;
export type TabName = keyof typeof TABS;
