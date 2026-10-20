import { userCanRead } from "@/lib/auth/access";
import { userFromRequest } from "@/lib/auth/user-session";
import { getBookBySlug } from "@/lib/db/repo";
import { downloadsAvailable } from "@/lib/db/users";
import { downloadInfo } from "@/lib/downloads-original";
import { jsonError, ok, safe } from "@/lib/http";

// What the download dialog needs to pick the fastest method: size of the original PDF (0 = none) and the average page image.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "No autorizado");
  if (!(await downloadsAvailable()) || !s.user.can_download) return jsonError(403, "No permitido");
  const book = await getBookBySlug((await params).slug);
  if (!book || book.status !== "published" || !(await userCanRead(s.user, book))) return jsonError(404, "No encontrado");
  return ok(await downloadInfo(book));
});
