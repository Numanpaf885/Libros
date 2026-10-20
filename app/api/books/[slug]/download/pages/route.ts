import { z } from "zod";
import { userCanRead } from "@/lib/auth/access";
import { userFromRequest } from "@/lib/auth/user-session";
import { getBookBySlug } from "@/lib/db/repo";
import { downloadsAvailable, listDownloads } from "@/lib/db/users";
import { verifyDownloadToken } from "@/lib/download-token";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { GET_TTL_S, storage } from "@/lib/storage";

const schema = z.object({ token: z.string().min(20).max(2000), pages: z.array(z.number().int().min(1).max(5000)).min(1).max(20) });

// Presigned page URLs (60 s each, up to 20 per call) for ONE download: only with its token, only for its range, only for
// the user it was issued to, and only while the account still has the permission.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "No autorizado");
  const denied = guardOrigin(req);
  if (denied) return denied;
  if (!(await downloadsAvailable())) return jsonError(404, "No encontrado");
  const no = () => jsonError(403, "No permitido");
  if (!s.user.can_download) return no();
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  const book = await getBookBySlug((await params).slug);
  if (!book || book.status !== "published" || !(await userCanRead(s.user, book))) return no();
  const claims = await verifyDownloadToken(body.token);
  if (!claims || claims.uid !== s.user.id || claims.bid !== book.id) return no();
  if (body.pages.some((n) => n < claims.from || n > claims.to || n > book.page_count)) return no();
  // A download that has ended (finished, cancelled, failed) cannot be continued with its token.
  const row = (await listDownloads()).find((d) => d.id === claims.did);
  if (row && row.status !== "started") return no();
  const urls = await Promise.all(body.pages.map(async (page) => ({ page, url: await storage().presignGet(`${book.storage_prefix}/${page}.webp`, GET_TTL_S) })));
  return ok({ urls, expires_in: GET_TTL_S });
});
