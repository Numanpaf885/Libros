import { NextResponse } from "next/server";
import { clearUserCookie, userFromRequest } from "@/lib/auth/user-session";
import { modifyUser } from "@/lib/db/users";
import { guardOrigin, jsonError, safe } from "@/lib/http";

// Raising session_version makes every cookie issued so far invalid (on this and every other device).
export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  await modifyUser(s.user.id, (u) => ({ ...u, session_version: u.session_version + 1 }));
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearUserCookie(res);
  return res;
});
