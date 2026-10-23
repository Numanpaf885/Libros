import { readerSession } from "@/lib/auth/reader";
import { readerHasText } from "@/lib/book-text";
import { jsonError, ok, safe } from "@/lib/http";
import { GET_TTL_S, storage, textKey } from "@/lib/storage";
import { chunkCount } from "@/lib/text-layer";

// The text of 20 pages (chunk 0 = pages 1-20) for the reader's selectable layer. Same access check as the pages
// (code cookie or signed-in account, revocation included) and a 60 s presigned URL. 404 when the book has no text
// for readers (no text yet, copying switched off by the admin, or a sheet without the text columns).
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string; chunk: string }> }) => {
  const { slug, chunk } = await params;
  const s = await readerSession(req, slug);
  if (!s) return jsonError(401, "No autorizado");
  const k = /^(0|[1-9][0-9]{0,2})$/.test(chunk) ? Number(chunk) : -1;
  if (k < 0 || k >= chunkCount(s.book.page_count) || !(await readerHasText(s.book))) return jsonError(404, "No encontrado");
  const key = textKey(s.book.storage_prefix, k);
  if ((await storage().head(key)) === null) return jsonError(404, "No encontrado");
  const url = await storage().presignGet(key, GET_TTL_S);
  return ok({ url, expires_in: GET_TTL_S });
});
