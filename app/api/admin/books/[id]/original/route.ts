import { z } from "zod";
import { isReplacement } from "@/lib/books";
import { bookExtrasReady, getBookById, saveBook } from "@/lib/db/repo";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { parseLabels, stringifyLabels } from "@/lib/page-labels";
import { MAX_ORIGINAL_BYTES, MAX_PARTS, PART_SIZE, originalKey, storage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };
const idOk = z.string().uuid();
const uploadId = z.string().min(8).max(1024);
const partsFor = (size: number) => Math.ceil(size / PART_SIZE);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), size: z.number().int().min(1).max(MAX_ORIGINAL_BYTES), pages: z.number().int().min(1).max(5000) }),
  z.object({ action: z.literal("parts"), uploadId }),
  z.object({ action: z.literal("urls"), uploadId, parts: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(20) }),
  z.object({ action: z.literal("complete"), uploadId, size: z.number().int().min(1).max(MAX_ORIGINAL_BYTES), pages: z.number().int().min(1).max(5000), page_labels: z.string().max(20000).optional() }),
  z.object({ action: z.literal("abort"), uploadId }),
]);

async function target(id: string) {
  const book = await getBookById(id);
  return book && !isReplacement(book) ? book : null;
}

// Admin only. The original PDF of a book goes to R2 as an S3 multipart upload under the book's own prefix:
// start -> (urls -> the browser PUTs parts) -> complete. The server reads the part ETags itself, so the browser never has to.
export const POST = safe(async (req: Request, { params }: Ctx) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await bookExtrasReady())) return jsonError(409, "Falta actualizar la hoja de cálculo: ejecuta npm run setup-sheet.");
  const id = idOk.safeParse((await params).id);
  const b = await parseBody(req, body);
  if (!id.success || !b) return jsonError(400, "Solicitud no válida");
  const book = await target(id.data);
  if (!book || book.status === "uploading") return jsonError(404, "No encontrado");
  const key = originalKey(book.storage_prefix);

  if (b.action === "start") {
    if (b.pages !== book.page_count) return jsonError(400, `Este PDF tiene ${b.pages} páginas y el libro tiene ${book.page_count}. Tiene que ser el mismo PDF.`);
    if (partsFor(b.size) > MAX_PARTS) return jsonError(400, "El archivo es demasiado grande.");
    const uid = await storage().createMultipart(key);
    return ok({ uploadId: uid, partSize: PART_SIZE, parts: partsFor(b.size) }, { status: 201 });
  }
  if (b.action === "parts") {
    // what the server already has of this upload, so a resumed upload sends only the missing parts
    const have = await storage().listParts(key, b.uploadId).catch(() => null);
    if (!have) return jsonError(404, "La subida ya no existe.");
    return ok({ parts: have.map((p) => ({ part: p.part, size: p.size })) });
  }
  if (b.action === "urls") {
    const urls = await Promise.all(b.parts.map(async (part) => ({ part, url: await storage().presignPart(key, b.uploadId, part) })));
    return ok({ urls });
  }
  if (b.action === "abort") {
    await storage().abortMultipart(key, b.uploadId);
    return ok();
  }
  // complete
  if (b.pages !== book.page_count) return jsonError(400, "El número de páginas no coincide con el libro.");
  const have = await storage().listParts(key, b.uploadId).catch(() => null);
  if (!have) return jsonError(404, "La subida ya no existe. Empieza de nuevo.");
  const need = partsFor(b.size);
  const sorted = [...have].sort((x, y) => x.part - y.part);
  const sum = sorted.reduce((n, p) => n + p.size, 0);
  const shape = sorted.length === need && sorted.every((p, i) => p.part === i + 1 && (i < need - 1 ? p.size === PART_SIZE : true));
  if (!shape || sum !== b.size) return jsonError(400, "Faltan partes del archivo. Continúa la subida.");
  await storage().completeMultipart(key, b.uploadId, sorted.map((p) => ({ part: p.part, etag: p.etag })));
  const stored = await storage().head(key);
  if (stored !== b.size) {
    await storage().deleteKey(key).catch(() => {});
    return jsonError(500, "El archivo no se ha guardado bien. Inténtalo de nuevo.");
  }
  const fresh = (await getBookById(book.id)) ?? book;
  // Printed page numbers found in the PDF are kept only while the book has none of its own.
  const labels = fresh.page_labels ? fresh.page_labels : stringifyLabels(parseLabels(b.page_labels, fresh.page_count));
  const saved = await saveBook({ ...fresh, original_pdf_size: b.size, original_pdf_pages: b.pages, page_labels: labels });
  return ok({ original_pdf_size: saved.original_pdf_size, page_labels: saved.page_labels });
});

// "Quitar PDF original": deletes the object and clears the columns.
export const DELETE = safe(async (req: Request, { params }: Ctx) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await bookExtrasReady())) return jsonError(409, "Falta actualizar la hoja de cálculo: ejecuta npm run setup-sheet.");
  const id = idOk.safeParse((await params).id);
  if (!id.success) return jsonError(400, "Solicitud no válida");
  const book = await target(id.data);
  if (!book || book.status === "uploading") return jsonError(404, "No encontrado");
  await storage().deleteKey(originalKey(book.storage_prefix));
  await saveBook({ ...book, original_pdf_size: 0, original_pdf_pages: 0 });
  return ok();
});
