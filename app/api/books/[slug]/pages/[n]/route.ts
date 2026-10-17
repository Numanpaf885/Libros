import { readerSession } from "@/lib/auth/reader";
import { jsonError, ok, safe } from "@/lib/http";
import { GET_TTL_S, storage } from "@/lib/storage";

// Cookie-checked on every call (revocation included). Returns a presigned URL valid for 60 s;
// the browser fetches the image bytes from it and draws them on a canvas.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string; n: string }> }) => {
  const { slug, n } = await params;
  const s = await readerSession(req, slug);
  if (!s) return jsonError(401, "No autorizado");
  const page = /^[1-9][0-9]{0,4}$/.test(n) ? Number(n) : 0;
  if (page < 1 || page > s.book.page_count) return jsonError(404, "No encontrado");
  const url = await storage().presignGet(`${s.book.storage_prefix}/${page}.webp`, GET_TTL_S);
  return ok({ url, expires_in: GET_TTL_S });
});
