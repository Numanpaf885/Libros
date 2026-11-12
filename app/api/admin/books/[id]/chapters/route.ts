import { z } from "zod";
import { isReplacement } from "@/lib/books";
import { MAX_RAW, normalizeChapters, stringifyChapters } from "@/lib/chapters";
import { chaptersReady, getBookById, saveBook } from "@/lib/db/repo";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({
  chapters: z.array(z.object({ t: z.string().max(400), p: z.number().int().min(1).max(5000) })).max(1000),
});

// Admin only. Saves a book's chapters (title + first file page); an empty list removes them. Entries are cleaned,
// sorted and kept within the book's pages before they are stored.
export const PUT = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await chaptersReady())) return jsonError(409, "Actualiza la base de datos en Mantenimiento.");
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || isReplacement(book)) return jsonError(404, "No encontrado");
  if (body.chapters.some((c) => !c.t.trim())) return jsonError(400, "Cada capítulo necesita un título.");
  if (body.chapters.some((c) => c.p > book.page_count)) return jsonError(400, `Las páginas van de 1 a ${book.page_count}.`);
  const chapters = normalizeChapters(body.chapters, book.page_count);
  const raw = stringifyChapters(chapters);
  if (raw.length > MAX_RAW) return jsonError(400, "Hay demasiados capítulos o títulos demasiado largos.");
  const saved = await saveBook({ ...book, chapters: raw });
  return ok({ chapters: saved.chapters });
});
