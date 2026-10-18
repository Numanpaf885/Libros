import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { rpFor, setChallenge } from "@/lib/auth/passkey";
import { guardOrigin, jsonError, ok, safe } from "@/lib/http";

// No username: the browser offers the passkeys it holds for this site (also through autofill).
export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const rp = rpFor(req);
  if (!rp) return jsonError(400, "Face ID y huella no están disponibles en esta dirección.");
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  const res = ok(options);
  await setChallenge(res, options.challenge, "auth");
  return res;
});
