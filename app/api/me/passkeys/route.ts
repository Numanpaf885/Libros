import { userFromRequest } from "@/lib/auth/user-session";
import { passkeysOf } from "@/lib/db/users";
import { jsonError, ok, safe } from "@/lib/http";

// Label and dates only: never the credential id or the public key.
export const GET = safe(async (req: Request) => {
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const list = (await passkeysOf(s.user.id)).map((p) => ({ id: p.id, label: p.label, created_at: p.created_at, last_used_at: p.last_used_at }));
  return ok({ passkeys: list });
});
