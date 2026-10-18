import { after } from "next/server";
import { z } from "zod";
import { userCanRead } from "@/lib/auth/access";
import { renewIfNeeded, userFromRequest } from "@/lib/auth/user-session";
import { getBookBySlug } from "@/lib/db/repo";
import { drainProgress, recordProgress } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ slug: z.string().min(1).max(200), page: z.number().int().min(1).max(100000) });

// The page is kept in memory at once and written to the sheet by the coalescing writer after the response.
export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  const book = await getBookBySlug(body.slug);
  if (!book || book.status !== "published" || body.page > book.page_count || !(await userCanRead(s.user, book))) return jsonError(404, "No encontrado");
  await recordProgress(s.user.id, book.id, body.page);
  after(() => drainProgress());
  const res = ok();
  await renewIfNeeded(res, s);
  return res;
});
