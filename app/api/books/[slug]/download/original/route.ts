import { z } from "zod";
import { userCanRead } from "@/lib/auth/access";
import { userFromRequest } from "@/lib/auth/user-session";
import { getBookBySlug } from "@/lib/db/repo";
import { downloadsAvailable } from "@/lib/db/users";
import { verifyDownloadToken } from "@/lib/download-token";
import { findDownload, issueOriginalUrl } from "@/lib/downloads-original";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ token: z.string().min(20).max(2000) });

// The presigned URL of the original PDF for ONE download: only with its token, only for the user it was issued to, only
// while the account still has the permission. Whole-book downloads are logged "sent" here.
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
  const r = await issueOriginalUrl(book, await findDownload(claims.did), (d) => d.actor === "user" && d.user_id === s.user.id);
  return r ? ok(r) : no();
});
