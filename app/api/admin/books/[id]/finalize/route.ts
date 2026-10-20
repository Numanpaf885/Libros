import { z } from "zod";
import { isReplacement, replacementTarget, toAdminBook, verifyUpload } from "@/lib/books";
import { deleteBookRow, getBookById, saveBook } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { storage } from "@/lib/storage";

const schema = z.object({ status: z.enum(["published", "draft"]).default("draft") });

// Called once every page is stored. A new book flips from "uploading" to its real status.
// A replacement swaps its prefix into the original row FIRST, then deletes the old prefix.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || book.status !== "uploading") return jsonError(404, "No encontrado");
  if (!(await verifyUpload(book.storage_prefix, book.page_count))) return jsonError(400, "La subida no está completa");

  if (!isReplacement(book)) {
    return ok({ book: toAdminBook(await saveBook({ ...book, status: body.status })) });
  }
  const original = await getBookById(replacementTarget(book));
  if (!original) return jsonError(404, "No encontrado");
  const oldPrefix = original.storage_prefix;
  const saved = await saveBook({
    ...original,
    storage_prefix: book.storage_prefix,
    cover_path: book.cover_path,
    page_count: book.page_count,
    // the old prefix (with the old original PDF) is deleted just below: the replaced book starts with no original and no labels
    original_pdf_size: 0,
    original_pdf_pages: 0,
    page_labels: "",
  });
  await deleteBookRow(book.id); // temp row only; its pages now belong to the original
  await storage().deletePrefix(oldPrefix);
  return ok({ book: toAdminBook(saved) });
});
