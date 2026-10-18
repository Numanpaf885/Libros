import { z } from "zod";
import { tooMany } from "@/lib/auth/me";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { startSession, userFromRequest } from "@/lib/auth/user-session";
import { modifyUser } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const key = `upw:${clientIp(req)}`;
  if (isLimited(key)) return jsonError(429, tooMany(retryAfterSec(key)));
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  if (!(await verifyPassword(body.current, s.user.password_hash))) {
    recordFailure(key);
    return jsonError(401, "La contraseña actual no es correcta");
  }
  const problem = passwordProblem(body.next, s.user.username);
  if (problem) return jsonError(400, problem);
  const password_hash = await hashPassword(body.next);
  // New password: every other device is signed out, this one gets a fresh cookie.
  const fresh = await modifyUser(s.user.id, (u) => ({ ...u, password_hash, session_version: u.session_version + 1 }));
  if (!fresh) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const res = ok();
  await startSession(res, fresh);
  return res;
});
