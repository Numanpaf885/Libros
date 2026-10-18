import { generateRegistrationOptions } from "@simplewebauthn/server";
import { rpFor, setChallenge } from "@/lib/auth/passkey";
import { userFromRequest } from "@/lib/auth/user-session";
import { passkeysOf } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, safe } from "@/lib/http";
import { SITE_NAME } from "@/lib/site";

const MAX_PASSKEYS = 10;

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const rp = rpFor(req);
  if (!rp) return jsonError(400, "Face ID y huella no están disponibles en esta dirección.");
  const existing = await passkeysOf(s.user.id);
  if (existing.length >= MAX_PASSKEYS) return jsonError(400, "Has alcanzado el máximo de dispositivos. Quita alguno primero.");
  const options = await generateRegistrationOptions({
    rpName: SITE_NAME,
    rpID: rp.rpID,
    userName: s.user.username,
    userDisplayName: s.user.display_name,
    userID: new TextEncoder().encode(s.user.id),
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports ? p.transports.split(",") : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const res = ok(options);
  await setChallenge(res, options.challenge, "reg", s.user.id);
  return res;
});
