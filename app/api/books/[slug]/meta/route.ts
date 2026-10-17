import { readerSession } from "@/lib/auth/reader";
import { jsonError, ok, safe } from "@/lib/http";

// Gives the reader UI what it needs (and nothing else): title and page count.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await readerSession(req, (await params).slug);
  if (!s) return jsonError(401, "No autorizado");
  return ok({ title: s.book.title, page_count: s.book.page_count });
});
