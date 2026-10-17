import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { signAdmin } from "@/lib/auth/admin";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { ADMIN_COOKIE, ADMIN_TTL_S, COOKIE_SECURE } from "@/lib/config";
import { getAdmin } from "@/lib/db/repo";
import { jsonError, parseBody, safe } from "@/lib/http";

const schema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
// Real cost-12 hash, compared when the user is unknown so response timing matches.
let dummy: string | null = null;
const dummyHash = () => (dummy ??= bcrypt.hashSync(randomBytes(16).toString("hex"), 12));

export const POST = safe(async (req: Request) => {
  const key = `login:${clientIp(req)}`;
  if (isLimited(key)) {
    const mins = Math.max(1, Math.ceil(retryAfterSec(key) / 60));
    return jsonError(429, `Demasiados intentos. Vuelve a intentarlo en ${mins} ${mins === 1 ? "minuto" : "minutos"}.`);
  }
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");

  const admin = await getAdmin(body.username);
  const valid = await bcrypt.compare(body.password, admin?.password_hash ?? dummyHash());
  if (!admin || !valid) {
    recordFailure(key);
    return jsonError(401, "Usuario o contraseña incorrectos"); // same message for an unknown user
  }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, await signAdmin(admin.username), {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_TTL_S,
  });
  return res;
});
