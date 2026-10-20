import { ALL_BOOKS, type Book, type UserRecord } from "../types";
import { allGrants, allProgress, passkeysOf } from "../db/users";

export interface AdminUserView {
  id: string;
  username: string;
  display_name: string;
  status: UserRecord["status"];
  created_at: string;
  last_login_at: string;
  /** an activation code is waiting (not used, not expired, not burnt) */
  code_expires_at: string;
  all_books: boolean;
  /** books the admin picked (ids) */
  assigned: string[];
  /** books the reader unlocked with an access code (ids) */
  via_code: string[];
  progress: { book_id: string; title: string; page: number; page_count: number; updated_at: string; /** printed numbering of the book; only present when it has one */ page_labels?: string }[];
  passkeys: number;
  can_download: boolean;
}

/** What the admin sees about each user: never hashes, codes or key material. */
export async function adminUserViews(users: UserRecord[], books: Book[]): Promise<AdminUserView[]> {
  const grants = await allGrants();
  const progress = await allProgress();
  const byId = new Map(books.map((b) => [b.id, b]));
  return Promise.all(users.map(async (u) => {
    const mine = grants.filter((g) => g.user_id === u.id);
    return {
      id: u.id, username: u.username, display_name: u.display_name, status: u.status, created_at: u.created_at, last_login_at: u.last_login_at,
      code_expires_at: u.status === "pending" && u.setup_code_hash && Date.parse(u.setup_code_expires_at) > Date.now() ? u.setup_code_expires_at : "",
      all_books: mine.some((g) => g.source === "admin" && g.book_id === ALL_BOOKS),
      assigned: mine.filter((g) => g.source === "admin" && g.book_id !== ALL_BOOKS && byId.has(g.book_id)).map((g) => g.book_id),
      via_code: [...new Set(mine.filter((g) => g.source === "code" && byId.has(g.book_id)).map((g) => g.book_id))],
      progress: progress
        .filter((p) => p.user_id === u.id && byId.has(p.book_id))
        .map((p) => ({ book_id: p.book_id, title: byId.get(p.book_id)!.title, page: p.page, page_count: byId.get(p.book_id)!.page_count, updated_at: p.updated_at, ...(byId.get(p.book_id)!.page_labels ? { page_labels: byId.get(p.book_id)!.page_labels } : {}) })),
      passkeys: (await passkeysOf(u.id)).length,
      can_download: u.can_download,
    };
  }));
}
