import { ALL_BOOKS, type Book, type UserRecord } from "../types";
import { getCode } from "../db/repo";
import { userBookGrants } from "../db/users";

/**
 * What a signed-in user may read: books the admin assigned (or all of them), plus books unlocked with an access
 * code for as long as that code is still valid. The code is checked live, so revoking or replacing it ends the access.
 */
export async function readableBookIds(user: UserRecord, books: Book[]): Promise<Set<string>> {
  const grants = await userBookGrants(user.id);
  const out = new Set<string>();
  if (grants.some((g) => g.source === "admin" && g.book_id === ALL_BOOKS)) {
    for (const b of books) out.add(b.id);
    return out;
  }
  for (const g of grants) {
    if (g.source === "admin") out.add(g.book_id);
    else if (!out.has(g.book_id)) {
      const code = await getCode(g.code_id);
      if (code && code.book_id === g.book_id && !code.revoked && !(code.expires_at && Date.parse(code.expires_at) <= Date.now())) out.add(g.book_id);
    }
  }
  return out;
}
export async function userCanRead(user: UserRecord, book: Book): Promise<boolean> {
  return (await readableBookIds(user, [book])).has(book.id);
}
