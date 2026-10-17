import { z } from "zod";
import { getCode, setRevoked } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ revoked: z.boolean() });
export const PATCH = safe(async (req: Request, { params }: { params: Promise<{ id: string; codeId: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const p = await params;
  const ids = z.object({ id: z.string().uuid(), codeId: z.string().uuid() }).safeParse(p);
  const body = await parseBody(req, schema);
  if (!ids.success || !body) return jsonError(400, "Solicitud no válida");
  const code = await getCode(ids.data.codeId);
  if (!code || code.book_id !== ids.data.id) return jsonError(404, "No encontrado");
  await setRevoked(code.id, body.revoked);
  return ok();
});
