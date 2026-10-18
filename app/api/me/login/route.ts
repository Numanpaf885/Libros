import { z } from "zod";
import { GENERIC_LOGIN_ERROR, publicUser, tooMany } from "@/lib/auth/me";
import { dummyHash, verifyPassword } from "@/lib/auth/password";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { startSession } from "@/lib/auth/user-session";
import { LOGIN_LOCK_MS, LOGIN_MAX_FAILS } from "@/lib/config";
import { getUserByUsername, modifyUser } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const key = `ulogin:${clientIp(req)}`;
  if (isLimited(key)) return jsonError(429, tooMany(retryAfterSec(key)));
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");

  const user = await getUserByUsername(body.username);
  const locked = !!user && !!user.locked_until && Date.parse(user.locked_until) > Date.now();
  const usable = !!user && user.status === "active" && !!user.password_hash && !locked;
  // Always one bcrypt comparison, so unknown, locked and wrong-password cases take the same time.
  const valid = await verifyPassword(body.password, usable ? user.password_hash : dummyHash());
  if (!usable || !valid) {
    recordFailure(key);
    if (usable) {
      await modifyUser(user.id, (u) => {
        if (u.locked_until && Date.parse(u.locked_until) > Date.now()) return null;
        const fails = u.failed_logins + 1;
        return fails >= LOGIN_MAX_FAILS
          ? { ...u, failed_logins: 0, locked_until: new Date(Date.now() + LOGIN_LOCK_MS).toISOString() }
          : { ...u, failed_logins: fails };
      });
    }
    return jsonError(401, GENERIC_LOGIN_ERROR); // the same text for every failure
  }
  const fresh = await modifyUser(user.id, (u) => ({ ...u, failed_logins: 0, locked_until: "", last_login_at: new Date().toISOString() }));
  if (!fresh || fresh.status !== "active") return jsonError(401, GENERIC_LOGIN_ERROR);
  const res = ok({ user: await publicUser(fresh) });
  await startSession(res, fresh);
  return res;
});
