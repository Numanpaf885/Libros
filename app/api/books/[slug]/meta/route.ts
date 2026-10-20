import { userCanRead } from "@/lib/auth/access";
import { readerSession } from "@/lib/auth/reader";
import { userFromRequest } from "@/lib/auth/user-session";
import { downloadsAvailable, progressFor } from "@/lib/db/users";
import { jsonError, ok, safe } from "@/lib/http";

// Gives the reader UI what it needs (and nothing else): title, page count and, for a signed-in reader, the synced page.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await readerSession(req, (await params).slug);
  if (!s) return jsonError(401, "No autorizado");
  const u = await userFromRequest(req);
  const progress = u ? Math.min(await progressFor(u.user.id, s.book.id), s.book.page_count) : null;
  // Only a signed-in reader with the permission, on a sheet that has the download tab and column, ever sees true.
  const can_download = !!u && u.user.can_download && (await downloadsAvailable()) && (await userCanRead(u.user, s.book));
  return ok({ title: s.book.title, page_count: s.book.page_count, signed_in: !!u, progress, can_download });
});
