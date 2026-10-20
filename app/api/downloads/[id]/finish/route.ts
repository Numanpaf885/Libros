import { z } from "zod";
import { isAdminRequest } from "@/lib/auth/admin";
import { userFromRequest } from "@/lib/auth/user-session";
import { downloadsAvailable, finishDownload } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ status: z.enum(["completed", "cancelled", "failed"]) });

// The browser says how a download ended (one write). The tab-closed case arrives through navigator.sendBeacon.
// Admins can close their own downloads, readers theirs; a row that has ended never changes again.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await isAdminRequest(req);
  const user = admin ? null : await userFromRequest(req);
  if (!admin && !user) return jsonError(401, "No autorizado");
  const denied = guardOrigin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const body = await parseBody(req, schema);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  if (!(await downloadsAvailable())) return jsonError(404, "No encontrado");
  const r = await finishDownload(id.data, body.status, (d) => (admin ? d.actor === "admin" : d.actor === "user" && d.user_id === user!.user.id));
  if (r.state === "missing") return jsonError(404, "No encontrado");
  if (r.state === "forbidden") return jsonError(403, "No permitido");
  return ok();
});
