import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isReplacement, toAdminBook } from "@/lib/books";
import { bookExtrasReady, createBook, listBooks } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { slugify } from "@/lib/slug";

export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const all = await listBooks();
  const pending = new Map(all.filter(isReplacement).map((b) => [b.slug.replace(/^__replace__/, ""), b]));
  const books = all.filter((b) => !isReplacement(b)).map((b) => toAdminBook(b, pending.get(b.id) ?? null));
  // extras: whether `npm run setup-sheet` has added the page_labels / original_pdf_* columns (the admin UI hides those features otherwise)
  return ok({ books, extras: await bookExtrasReady() });
});

const create = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  page_count: z.number().int().min(1).max(5000),
  author: z.string().trim().max(120).default(""),
  category: z.string().trim().max(80).default(""),
  year: z.string().trim().regex(/^(\d{4})?$/).default(""),
});

// Creates the row in "uploading" state with a fresh random prefix. The browser then asks
// /api/admin/upload-urls for presigned PUT URLs and calls .../finalize when all pages are stored.
export const POST = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const body = await parseBody(req, create);
  if (!body) return jsonError(400, "Solicitud no válida");
  const existing = await listBooks();
  const base = slugify(body.title);
  let slug = base;
  for (let i = 2; existing.some((b) => b.slug === slug); i++) slug = `${base}-${i}`;
  const prefix = `books/${randomBytes(16).toString("hex")}`;
  const book = await createBook({
    slug, title: body.title, description: body.description, page_count: body.page_count,
    author: body.author, category: body.category, year: body.year,
    storage_prefix: prefix, cover_path: `${prefix}/cover.webp`, status: "uploading",
  });
  return ok({ book: toAdminBook(book) }, { status: 201 });
});
