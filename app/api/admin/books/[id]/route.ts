import { z } from "zod";
import { deleteBookRow, deleteCodesForBook, getBookById, listBooks, saveBook } from "@/lib/db/repo";
import { REPLACE_SLUG } from "@/lib/storage/constants";
import { toAdminBook } from "@/lib/books";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { storage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };
const idOk = z.string().uuid();

const patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  author: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  year: z.string().trim().regex(/^(\d{4})?$/).optional(),
  status: z.enum(["published", "draft"]).optional(),
});
export const PATCH = safe(async (req: Request, { params }: Ctx) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const body = await parseBody(req, patch);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book) return jsonError(404, "No encontrado");
  if (body.status && book.status === "uploading") return jsonError(400, "Termina primero la subida");
  const saved = await saveBook({ ...book, ...body });
  return ok({ book: toAdminBook(saved) });
});

const del = z.object({ title: z.string() });
export const DELETE = safe(async (req: Request, { params }: Ctx) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const body = await parseBody(req, del);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book) return jsonError(404, "No encontrado");
  if (body.title !== book.title) return jsonError(400, "El título no coincide");
  // A pending replacement upload belongs to this book: remove its pages and row too.
  const temp = (await listBooks()).find((b) => b.slug === `${REPLACE_SLUG}${book.id}`);
  if (temp) {
    await storage().deletePrefix(temp.storage_prefix);
    await deleteBookRow(temp.id);
  }
  await storage().deletePrefix(book.storage_prefix);
  await deleteCodesForBook(book.id);
  await deleteBookRow(book.id);
  return ok();
});
