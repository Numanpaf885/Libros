import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { publicUser, tooMany } from "@/lib/auth/me";
import { clearChallenge, fromB64u, readChallenge, rpFor } from "@/lib/auth/passkey";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { startSession } from "@/lib/auth/user-session";
import { getUserById, modifyPasskey, modifyUser, passkeyByCredential } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ response: z.looseObject({ id: z.string().max(1024) }) });
const FAIL = "No se ha podido entrar con Face ID o huella. Usa tu usuario y contraseña.";

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const key = `upk:${clientIp(req)}`;
  if (isLimited(key)) return jsonError(429, tooMany(retryAfterSec(key)));
  const rp = rpFor(req);
  const ch = await readChallenge(req, "auth");
  const body = await parseBody(req, schema);
  if (!rp || !ch || !body) return jsonError(401, FAIL);
  const fail = () => { recordFailure(key); return jsonError(401, FAIL); };

  const pk = await passkeyByCredential(body.response.id);
  const user = pk ? await getUserById(pk.user_id) : null;
  if (!pk || !user || user.status !== "active") return fail();
  const handle = (body.response as { response?: { userHandle?: unknown } }).response?.userHandle;
  if (typeof handle === "string" && handle && Buffer.from(handle, "base64url").toString() !== user.id) return fail();
  let counter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response: body.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: { id: pk.credential_id, publicKey: fromB64u(pk.public_key), counter: pk.counter, transports: pk.transports ? pk.transports.split(",") : undefined },
      requireUserVerification: true,
    });
    if (!v.verified) return fail();
    counter = v.authenticationInfo.newCounter; // the library has already rejected a counter that went backwards
  } catch {
    return fail();
  }
  const now = new Date().toISOString();
  await modifyPasskey(pk.id, (p) => ({ ...p, counter, last_used_at: now }));
  const fresh = await modifyUser(user.id, (u) => ({ ...u, last_login_at: now }));
  if (!fresh || fresh.status !== "active") return fail();
  const res = ok({ user: await publicUser(fresh) });
  await startSession(res, fresh);
  clearChallenge(res);
  return res;
});
