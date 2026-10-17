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
export interface PublicBook {
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
