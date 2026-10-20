export type BookStatus = "published" | "draft" | "uploading";

export interface Book {
  id: string;
  slug: string;
  title: string;
  description: string;
  page_count: number;
  storage_prefix: string;
  cover_path: string;
  status: BookStatus;
  updated_at: string;
  /** optional presentation fields; empty string when not set */
  author: string;
  category: string;
  year: string;
}

export interface AccessCode {
  id: string;
  book_id: string;
  code_hash: string;
  label: string;
  created_at: string;
  expires_at: string; // ISO or ""
  revoked: boolean;
}

export interface AdminUser {
  username: string;
  password_hash: string;
}

/** Public-safe projections: never include storage_prefix, cover_path or hashes. */
interface PublicBook {
  slug: string;
  title: string;
  description: string;
  page_count: number;
  author: string;
  category: string;
  year: string;
}

export interface AdminBook extends PublicBook {
  id: string;
  status: BookStatus;
  updated_at: string;
  /** id of an in-progress replacement upload for this book, if any */
  pending_replacement: string | null;
}

export interface AdminCode {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}

export type UserStatus = "pending" | "active" | "disabled";
export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  status: UserStatus;
  setup_code_hash: string;
  setup_code_expires_at: string; // ISO or ""
  setup_attempts: number;
  failed_logins: number;
  locked_until: string; // ISO or ""
  session_version: number;
  created_at: string;
  last_login_at: string;
  /** users.can_download (column added later): may download books as PDF. false when the column is missing or empty. */
  can_download: boolean;
}
export interface UserBookRecord { user_id: string; book_id: string; source: "admin" | "code"; code_id: string; granted_at: string }
export interface ProgressRecord { user_id: string; book_id: string; page: number; updated_at: string }
export interface PasskeyRecord {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  label: string;
  created_at: string;
  last_used_at: string;
}
/** book_id used in user_books for "Todos los libros". */
export const ALL_BOOKS = "*";

export interface BookmarkRecord { id: string; user_id: string; book_id: string; page: number; label: string; created_at: string }

export type DownloadStatus = "started" | "completed" | "cancelled" | "failed";
/** One row of the `downloads` tab. username, display_name and book_title are snapshots taken when the download started. */
export interface DownloadRecord {
  id: string;
  actor: "admin" | "user";
  user_id: string;
  username: string;
  display_name: string;
  book_id: string;
  book_title: string;
  from_page: number;
  to_page: number;
  page_count: number;
  device: "Móvil" | "Ordenador";
  status: DownloadStatus;
  created_at: string;
  finished_at: string;
}
