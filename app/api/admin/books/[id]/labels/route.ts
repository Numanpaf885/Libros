import { z } from "zod";
import { isReplacement } from "@/lib/books";
import { bookExtrasReady, getBookById, saveBook } from "@/lib/db/repo";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { parseLabels, stringifyLabels } from "@/lib/page-labels";

const schema = z.object({ page_labels: z.string().max(20000) });

// Admin only. Saves the printed page numbering of a book ("" = none). Invalid JSON is refused, never stored.
export const PUT = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await bookExtrasReady())) return jsonError(409, "Falta actualizar la hoja de cálculo: ejecuta npm run setup-sheet.");
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || isReplacement(book)) return jsonError(404, "No encontrado");
  const ranges = parseLabels(body.page_labels, book.page_count);
  if (body.page_labels.trim() && !ranges.length) return jsonError(400, "La numeración no es válida.");
  const saved = await saveBook({ ...book, page_labels: stringifyLabels(ranges) });
  return ok({ page_labels: saved.page_labels });
});
