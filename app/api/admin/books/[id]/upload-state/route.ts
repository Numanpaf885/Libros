import { z } from "zod";
import { uploadState } from "@/lib/books";
import { getBookById } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, safe } from "@/lib/http";

// Tells the browser which pages are already stored so a resumed upload sends only the missing ones.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || book.status !== "uploading") return jsonError(404, "No encontrado");
  const st = await uploadState(book);
  return ok({ page_count: book.page_count, pages: st.pages, cover: st.cover });
});
