import { randomBytes } from "node:crypto";
import { z } from "zod";
import { REPLACE_SLUG } from "@/lib/storage/constants";
import { isReplacement, toAdminBook } from "@/lib/books";
import { createBook, getBookById, listBooks } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ page_count: z.number().int().min(1).max(5000) });

// Starts (or returns the existing) replacement upload: a hidden "uploading" row under a NEW prefix.
// The live book keeps serving the old pages until /finalize swaps the prefix.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book || book.status === "uploading" || isReplacement(book)) return jsonError(404, "No encontrado");

  const slug = `${REPLACE_SLUG}${book.id}`;
  const existing = (await listBooks()).find((b) => b.slug === slug);
  if (existing) return ok({ book: toAdminBook(existing) });
  const prefix = `books/${randomBytes(16).toString("hex")}`;
  const temp = await createBook({
    slug, title: book.title, description: book.description, page_count: body.page_count,
    author: book.author, category: book.category, year: book.year,
    storage_prefix: prefix, cover_path: `${prefix}/cover.webp`, status: "uploading",
  });
  return ok({ book: toAdminBook(temp) }, { status: 201 });
});
