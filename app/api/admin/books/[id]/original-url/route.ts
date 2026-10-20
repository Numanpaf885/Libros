import { z } from "zod";
import { getBookById } from "@/lib/db/repo";
import { findDownload, issueOriginalUrl } from "@/lib/downloads-original";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ download_id: z.string().uuid() });

// Admin only: the original PDF URL for one of the admin's own logged downloads (same rules as readers').
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  const book = id.success ? await getBookById(id.data) : null;
  if (!body || !book) return jsonError(400, "Solicitud no válida");
  const r = await issueOriginalUrl(book, await findDownload(body.download_id), (d) => d.actor === "admin");
  return r ? ok(r) : jsonError(403, "No permitido");
});
