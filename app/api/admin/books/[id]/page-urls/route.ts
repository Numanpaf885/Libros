import { z } from "zod";
import { getBookById } from "@/lib/db/repo";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { GET_TTL_S, storage } from "@/lib/storage";

const schema = z.object({ pages: z.array(z.number().int().min(1).max(5000)).min(1).max(20) });

// Admin only: presigned GET URLs (60 s each, up to 20 per call) for the pages of ANY book, whatever its status.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || body.pages.some((n) => n > book.page_count)) return jsonError(404, "No encontrado");
  const urls = await Promise.all(body.pages.map(async (page) => ({ page, url: await storage().presignGet(`${book.storage_prefix}/${page}.webp`, GET_TTL_S) })));
  return ok({ urls, expires_in: GET_TTL_S });
});
