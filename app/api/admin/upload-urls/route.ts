import { z } from "zod";
import { getBookById } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { storage } from "@/lib/storage";

const schema = z.object({
  book_id: z.string().uuid(),
  // 0 = cover, 1..N = pages. At most 20 per request.
  pages: z.array(z.number().int().min(0).max(5000)).min(1).max(20),
});

export const POST = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(body.book_id);
  if (!book || book.status !== "uploading") return jsonError(404, "No encontrado");
  if (body.pages.some((n) => n > book.page_count)) return jsonError(400, "Solicitud no válida");
  const urls = await Promise.all(
    body.pages.map(async (n) => ({
      page: n,
      url: await storage().presignPut(`${book.storage_prefix}/${n === 0 ? "cover" : n}.webp`),
    })),
  );
  return ok({ urls });
});
