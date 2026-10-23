import { z } from "zod";
import { isReplacement } from "@/lib/books";
import { pageMap, readAllText, textSummary } from "@/lib/book-text";
import { getBookById, saveBook, textColumnsReady } from "@/lib/db/repo";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { GET_TTL_S, originalKey, storage, textKey, textPrefix } from "@/lib/storage";
import { chunkCount } from "@/lib/text-layer";
import type { Book } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const idOk = z.string().uuid();
const chunks = z.array(z.number().int().min(0).max(250)).min(1).max(20);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("urls"), chunks }), // presigned PUT URLs (JSON) for these chunks
  z.object({ action: z.literal("read"), chunks }), // presigned GET URLs, to continue a chunk that is partly done
  z.object({ action: z.literal("original") }), // the stored original PDF, read with Range requests by "Extraer texto"
  z.object({ action: z.literal("finish") }), // count the pages with text and save text_status / text_pages
  z.object({ action: z.literal("clear") }), // "Volver a extraer": delete the text, keep everything else
  z.object({ action: z.literal("settings"), allow_copy: z.boolean() }),
]);

const notReady = () => jsonError(409, "Falta actualizar la base de datos: ve a Mantenimiento y pulsa «Actualizar base de datos».");
const state = async (b: Book) => {
  const pages = await readAllText(b);
  const sum = textSummary(pages, b.page_count);
  return { ...sum, pages: pageMap(pages, b.page_count) };
};

// Admin only. The text of a book's pages (selectable layer): status, upload of the JSON chunks, the switch.
export const GET = safe(async (req: Request, { params }: Ctx) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const book = id.success ? await getBookById(id.data) : null;
  if (!book) return jsonError(404, "No encontrado");
  if (!(await textColumnsReady())) return ok({ ready: false });
  const s = await state(book);
  return ok({
    ready: true, page_count: book.page_count, text_status: book.text_status, text_pages: book.text_pages, allow_copy: book.allow_copy,
    has_original: book.original_pdf_size > 0, original_size: book.original_pdf_size, scanned: s.scanned, pending: s.pending, pages: s.pages,
  });
});

export const POST = safe(async (req: Request, { params }: Ctx) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await textColumnsReady())) return notReady();
  const id = idOk.safeParse((await params).id);
  const b = await parseBody(req, body);
  if (!id.success || !b) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book) return jsonError(404, "No encontrado");
  // An upload in progress (new book or replacement) may store its text; everything else needs a finished book.
  const live = book.status !== "uploading" && !isReplacement(book);

  if (b.action === "urls" || b.action === "read") {
    if (b.chunks.some((k) => k >= chunkCount(book.page_count))) return jsonError(400, "Solicitud no válida");
    const urls = await Promise.all(b.chunks.map(async (k) => {
      const key = textKey(book.storage_prefix, k);
      if (b.action === "urls") return { chunk: k, url: await storage().presignPut(key, "application/json") };
      // null when the chunk is not stored yet (nothing to continue)
      return { chunk: k, url: (await storage().head(key)) === null ? null : await storage().presignGet(key, GET_TTL_S) };
    }));
    return ok({ urls });
  }
  if (b.action === "finish") {
    const s = await state(book);
    const saved = await saveBook({ ...((await getBookById(book.id)) ?? book), text_status: s.status, text_pages: s.text_pages });
    return ok({ text_status: saved.text_status, text_pages: saved.text_pages, scanned: s.scanned, pending: s.pending, pages: s.pages });
  }
  if (!live) return jsonError(404, "No encontrado");
  if (b.action === "original") {
    if (book.original_pdf_size <= 0) return jsonError(404, "Este libro no tiene el PDF original guardado.");
    return ok({ url: await storage().presignGet(originalKey(book.storage_prefix), GET_TTL_S), size: book.original_pdf_size, expires_in: GET_TTL_S });
  }
  if (b.action === "clear") {
    await storage().deletePrefix(textPrefix(book.storage_prefix));
    const saved = await saveBook({ ...book, text_status: "none", text_pages: 0 });
    return ok({ text_status: saved.text_status, text_pages: saved.text_pages });
  }
  const saved = await saveBook({ ...book, allow_copy: b.allow_copy });
  return ok({ allow_copy: saved.allow_copy });
});
