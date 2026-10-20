import { z } from "zod";
import { userCanRead } from "@/lib/auth/access";
import { userFromRequest } from "@/lib/auth/user-session";
import { overLimit } from "@/lib/auth/ratelimit";
import { getBookBySlug } from "@/lib/db/repo";
import { downloadsAvailable, downloadsSince, methodColumnReady, startDownload } from "@/lib/db/users";
import { methodAllowed } from "@/lib/download-method";
import { DOWNLOAD_TOKEN_TTL_S, MAX_DOWNLOADS_PER_HOUR, MAX_DOWNLOAD_PAGES, deviceOf, signDownloadToken } from "@/lib/download-token";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { randomUUID } from "node:crypto";

// `method` is optional: without it the download is logged as before (no method).
const schema = z.object({ from: z.number().int().min(1).max(5000), to: z.number().int().min(1).max(5000), method: z.enum(["original", "recorte", "imagenes"]).optional() });
const HOUR = 60 * 60_000;

// Starts a PDF download for a signed-in reader who has the permission: checks the account, the book, the range and the
// hourly limit, writes the log row (status "started") and returns a token that only works for this user, book and range.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "No autorizado");
  const denied = guardOrigin(req);
  if (denied) return denied;
  if (!(await downloadsAvailable())) return jsonError(404, "No encontrado");
  if (!s.user.can_download) return jsonError(403, "No tienes permiso para descargar este libro.");
  const book = await getBookBySlug((await params).slug);
  if (!book || book.status !== "published" || !(await userCanRead(s.user, book))) return jsonError(404, "No encontrado");
  const body = await parseBody(req, schema);
  if (!body || body.from > body.to || body.to > book.page_count) return jsonError(400, "Rango de páginas no válido.");
  if (body.to - body.from + 1 > MAX_DOWNLOAD_PAGES) return jsonError(400, `Puedes descargar como máximo ${MAX_DOWNLOAD_PAGES} páginas cada vez.`);
  const device = deviceOf(req);
  if (body.method && body.method !== "imagenes" && !(await methodColumnReady() && methodAllowed(body.method, { from: body.from, to: body.to, pageCount: book.page_count, originalSize: book.original_pdf_size, device }))) {
    return jsonError(400, "Este método de descarga no está disponible.");
  }
  // Counted from the log (any outcome counts) and, per server instance, in memory.
  if ((await downloadsSince(s.user.id, Date.now() - HOUR)) >= MAX_DOWNLOADS_PER_HOUR || overLimit(`dl:${s.user.id}`, MAX_DOWNLOADS_PER_HOUR, HOUR)) {
    return jsonError(429, `Has alcanzado el límite de ${MAX_DOWNLOADS_PER_HOUR} descargas por hora. Inténtalo más tarde.`);
  }
  const id = randomUUID();
  await startDownload({
    id, actor: "user", user_id: s.user.id, username: s.user.username, display_name: s.user.display_name,
    book_id: book.id, book_title: book.title, from_page: body.from, to_page: body.to, page_count: body.to - body.from + 1,
    device, status: "started", created_at: new Date().toISOString(), finished_at: "", method: body.method ?? "",
  });
  const token = await signDownloadToken({ did: id, uid: s.user.id, bid: book.id, from: body.from, to: body.to });
  return ok({ id, token, expires_in: DOWNLOAD_TOKEN_TTL_S });
});
