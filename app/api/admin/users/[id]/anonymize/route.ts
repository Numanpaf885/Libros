import { z } from "zod";
import { anonymizeUserHistory } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, safe } from "@/lib/http";

// Admin only: when deleting an account, "Anonimizar también su historial de descargas y mensajes" replaces its name,
// username and email with "Usuario eliminado" in those rows. Works by id, also after the account is gone.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return jsonError(400, "Solicitud no válida");
  return ok(await anonymizeUserHistory(id.data));
});
