import { randomUUID } from "node:crypto";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { b64u, clearChallenge, deviceLabel, readChallenge, rpFor } from "@/lib/auth/passkey";
import { userFromRequest } from "@/lib/auth/user-session";
import { addPasskey, passkeyByCredential } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ response: z.looseObject({ id: z.string().max(1024) }), label: z.string().trim().max(60).optional() });

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const rp = rpFor(req);
  const ch = await readChallenge(req, "reg");
  const body = await parseBody(req, schema);
  if (!rp || !ch || ch.userId !== s.user.id || !body) return jsonError(400, "No se ha podido activar Face ID o huella. Inténtalo de nuevo.");
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: body.response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!v.verified) throw new Error("not verified");
    info = v.registrationInfo;
  } catch {
    return jsonError(400, "No se ha podido activar Face ID o huella. Inténtalo de nuevo.");
  }
  if (await passkeyByCredential(info.credential.id)) return jsonError(400, "Este dispositivo ya está registrado.");
  await addPasskey({
    id: randomUUID(), user_id: s.user.id, credential_id: info.credential.id, public_key: b64u(info.credential.publicKey),
    counter: info.credential.counter, transports: (info.credential.transports ?? []).join(","),
    label: body.label || deviceLabel(req.headers.get("user-agent")), created_at: new Date().toISOString(), last_used_at: "",
  });
  const res = ok();
  clearChallenge(res);
  return res;
});
