import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { hashSetupCode } from "@/lib/auth/codes";
import { BAD_SETUP_CODE, publicUser, tooMany } from "@/lib/auth/me";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { startSession } from "@/lib/auth/user-session";
import { SETUP_MAX_ATTEMPTS } from "@/lib/config";
import { getUserByUsername, modifyUser } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import type { UserRecord } from "@/lib/types";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  code: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const usable = (u: UserRecord) =>
  u.status === "pending" && !!u.setup_code_hash && u.setup_attempts < SETUP_MAX_ATTEMPTS &&
  !!u.setup_code_expires_at && Date.parse(u.setup_code_expires_at) > Date.now();

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const key = `uact:${clientIp(req)}`;
  if (isLimited(key)) return jsonError(429, tooMany(retryAfterSec(key)));
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  // Password rules are checked first so a weak password never spends one of the code's 5 tries.
  const problem = passwordProblem(body.password, body.username);
  if (problem) return jsonError(400, problem);

  const user = await getUserByUsername(body.username);
  const hash = hashSetupCode(body.code);
  if (!user || !usable(user) || !same(hash, user.setup_code_hash)) {
    recordFailure(key);
    // A wrong code spends one of the 5 tries; the fifth one invalidates the code for good.
    if (user && usable(user)) {
      await modifyUser(user.id, (u) => {
        if (!usable(u)) return null;
        const attempts = u.setup_attempts + 1;
        return attempts >= SETUP_MAX_ATTEMPTS ? { ...u, setup_attempts: attempts, setup_code_hash: "", setup_code_expires_at: "" } : { ...u, setup_attempts: attempts };
      });
    }
    return jsonError(401, BAD_SETUP_CODE);
  }
  const password_hash = await hashPassword(body.password);
  // Re-check on the fresh row: two activations at once can only succeed once.
  const done = await modifyUser(user.id, (u) =>
    usable(u) && same(hash, u.setup_code_hash)
      ? { ...u, password_hash, status: "active", setup_code_hash: "", setup_code_expires_at: "", setup_attempts: 0, failed_logins: 0, locked_until: "", last_login_at: new Date().toISOString() }
      : null,
  );
  if (!done) return jsonError(401, BAD_SETUP_CODE);
  const res = ok({ user: await publicUser(done) });
  await startSession(res, done);
  return res;
});
