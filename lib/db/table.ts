/** Minimal row store. Rows are string[] in column order (header row excluded). */
export interface Table {
  list(tab: string): Promise<string[][]>;
  append(tab: string, row: string[]): Promise<void>;
  /** Replace the first row whose column 0 equals id. Returns false if missing. */
  updateById(tab: string, id: string, row: string[]): Promise<boolean>;
  /** Delete all rows whose column `col` equals value. */
  deleteWhere(tab: string, col: number, value: string): Promise<number>;
}

export const TABS = {
  books: ["id", "slug", "title", "description", "page_count", "storage_prefix", "cover_path", "status", "updated_at", "author", "category", "year"],
  access_codes: ["id", "book_id", "code_hash", "label", "created_at", "expires_at", "revoked"],
  admins: ["username", "password_hash"],
} as const;
export type TabName = keyof typeof TABS;
