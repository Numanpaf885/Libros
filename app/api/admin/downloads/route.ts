import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminUsername } from "@/lib/auth/admin";
import { getBookById } from "@/lib/db/repo";
import { downloadsAvailable, methodColumnReady, startDownload } from "@/lib/db/users";
import { methodAllowed } from "@/lib/download-method";
import { deviceOf } from "@/lib/download-token";
import { queryLog } from "@/lib/downloads-log";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const q = (u: URL, k: string) => u.searchParams.get(k) || undefined;

// The download log. With the `downloads` tab or the `users.can_download` column missing: { available: false }.
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  if (!(await downloadsAvailable())) return ok({ available: false });
  const u = new URL(req.url);
  const r = await queryLog({ user: q(u, "user"), book: q(u, "book"), from: q(u, "from"), to: q(u, "to"), page: Number(q(u, "page")) || 1, size: Math.min(Number(q(u, "size")) || 50, 50) });
  return ok({ available: true, total: r.total, page: r.page, pages: r.pages, size: r.size, rows: r.rows, filters: r.filters });
});

const start = z.object({ book_id: z.string().uuid(), from: z.number().int().min(1).max(5000), to: z.number().int().min(1).max(5000), method: z.enum(["original", "recorte", "imagenes"]).optional() });
// The admin's own downloads are logged too (actor "admin").
export const POST = safe(async (req: Request) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await downloadsAvailable())) return ok({ id: null });
  const body = await parseBody(req, start);
  const book = body ? await getBookById(body.book_id) : null;
  if (!body || !book || body.from > body.to || body.to > book.page_count) return jsonError(400, "Rango de páginas no válido.");
  const device = deviceOf(req);
  if (body.method && body.method !== "imagenes" && !(await methodColumnReady() && methodAllowed(body.method, { from: body.from, to: body.to, pageCount: book.page_count, originalSize: book.original_pdf_size, device }))) {
    return jsonError(400, "Este método de descarga no está disponible.");
  }
  const id = randomUUID();
  await startDownload({
    id, actor: "admin", user_id: "", username: (await adminUsername(req)) ?? "", display_name: "Admin",
    book_id: book.id, book_title: book.title, from_page: body.from, to_page: body.to, page_count: body.to - body.from + 1,
    device, status: "started", created_at: new Date().toISOString(), finished_at: "", method: body.method ?? "",
  });
  return ok({ id });
});
