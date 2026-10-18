import { after } from "next/server";
import { z } from "zod";
import { userCanRead } from "@/lib/auth/access";
import { overLimit } from "@/lib/auth/ratelimit";
import { renewIfNeeded, userFromRequest } from "@/lib/auth/user-session";
import { getBookBySlug } from "@/lib/db/repo";
import { applyBookmarkOps, bookmarksAvailable, bookmarksOf, drainBookmarks, type BookmarkOp } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import type { UserRecord } from "@/lib/types";

// Bookmarks of the signed-in reader, for one book. Own bookmarks only, and only for books the reader can open.
// `available: false` means the sheet has no bookmarks tab yet: the browser then keeps them on the device.
const label = z.string().max(200).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).pipe(z.string().max(60));
const post = z.object({
  slug: z.string().min(1).max(200),
  ops: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("add"), id: z.string().uuid(), page: z.number().int().min(1).max(100000), label: label.optional() }),
    z.object({ op: z.literal("remove"), id: z.string().uuid() }),
    z.object({ op: z.literal("rename"), id: z.string().uuid(), label }),
  ])).max(120),
});

const view = (list: Awaited<ReturnType<typeof bookmarksOf>>) => list.map((b) => ({ id: b.id, page: b.page, label: b.label, created_at: b.created_at }));
async function bookFor(slug: string, user: UserRecord) {
  const book = await getBookBySlug(slug);
  return book && book.status === "published" && (await userCanRead(user, book)) ? book : null;
}

export const GET = safe(async (req: Request) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  if (overLimit(`bm:${s.user.id}`, 120, 60_000)) return jsonError(429, "Demasiadas solicitudes. Espera un momento.");
  const slug = z.string().min(1).max(200).safeParse(new URL(req.url).searchParams.get("slug"));
  if (!slug.success) return jsonError(400, "Solicitud no válida");
  const book = await bookFor(slug.data, s.user);
  if (!book) return jsonError(404, "No encontrado");
  const available = await bookmarksAvailable();
  const res = ok({ available, bookmarks: available ? view(await bookmarksOf(s.user.id, book.id)) : [] });
  await renewIfNeeded(res, s);
  return res;
});

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  if (overLimit(`bm:${s.user.id}`, 120, 60_000)) return jsonError(429, "Demasiadas solicitudes. Espera un momento.");
  const body = await parseBody(req, post);
  if (!body) return jsonError(400, "Solicitud no válida");
  const book = await bookFor(body.slug, s.user);
  if (!book) return jsonError(404, "No encontrado");
  if (!(await bookmarksAvailable())) return ok({ available: false, bookmarks: [] }); // keep working: the browser stores them locally
  const ops: BookmarkOp[] = body.ops.map((o) => (o.op === "add" ? { op: "add", id: o.id, page: o.page, label: o.label ?? "" } : o));
  const fits = await applyBookmarkOps(s.user.id, book.id, ops, book.page_count);
  after(() => drainBookmarks());
  if (!fits) return jsonError(409, "Has alcanzado el límite de 100 marcadores en este libro.");
  const res = ok({ available: true, bookmarks: view(await bookmarksOf(s.user.id, book.id)) });
  await renewIfNeeded(res, s);
  return res;
});
