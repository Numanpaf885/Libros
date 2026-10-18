import { z } from "zod";
import { userFromRequest } from "@/lib/auth/user-session";
import { deletePasskey, passkeysOf } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, safe } from "@/lib/http";

export const DELETE = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success || !(await passkeysOf(s.user.id)).some((p) => p.id === id.data)) return jsonError(404, "No encontrado");
  await deletePasskey(id.data);
  return ok();
});
