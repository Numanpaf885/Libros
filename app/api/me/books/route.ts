import { readableBookIds } from "@/lib/auth/access";
import { renewIfNeeded, userFromRequest } from "@/lib/auth/user-session";
import { listBooks } from "@/lib/db/repo";
import { progressOf } from "@/lib/db/users";
import { jsonError, ok, safe } from "@/lib/http";

// The signed-in reader's books and where they are in each one. Public book fields only.
export const GET = safe(async (req: Request) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const published = (await listBooks()).filter((b) => b.status === "published");
  const can = await readableBookIds(s.user, published);
  const progress = new Map((await progressOf(s.user.id)).map((p) => [p.book_id, p.page]));
  const books = published
    .filter((b) => can.has(b.id))
    .map((b) => ({ slug: b.slug, title: b.title, author: b.author, page_count: b.page_count, page: Math.min(progress.get(b.id) ?? 0, b.page_count) }));
  const res = ok({ books });
  await renewIfNeeded(res, s);
  return res;
});
