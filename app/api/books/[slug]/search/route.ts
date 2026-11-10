import { clientIp, overLimit } from "@/lib/auth/ratelimit";
import { readerSession } from "@/lib/auth/reader";
import { bookSearchable, searchBook } from "@/lib/book-search";
import { jsonError, ok, safe } from "@/lib/http";
import { MAX_QUERY, MIN_QUERY, normalizeQuery } from "@/lib/text-search";

// Searches the book's text for the reader. Same access check as the pages (code cookie or signed-in account). Matches
// ignore case and accents. When the admin does not allow copying, only pages, counts and boxes are returned (no text).
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await readerSession(req, (await params).slug);
  if (!s) return jsonError(401, "No autorizado");
  if (!(await bookSearchable(s.book))) return jsonError(404, "Este libro no tiene texto para buscar.");
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY + 20);
  if (normalizeQuery(q).length < MIN_QUERY) return jsonError(400, `Escribe al menos ${MIN_QUERY} letras.`);
  if (overLimit(`search:${s.code?.id ?? clientIp(req)}`, 60, 60_000)) return jsonError(429, "Demasiadas búsquedas seguidas. Espera un momento.");
  return ok(await searchBook(s.book, q, s.book.allow_copy));
});
