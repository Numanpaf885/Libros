import { NextResponse } from "next/server";
import { z } from "zod";
import { codeCandidates, hashCode, legacyHashCode } from "@/lib/auth/codes";
import { clientIp, isLimited, recordFailure, retryAfterSec } from "@/lib/auth/ratelimit";
import { signReader } from "@/lib/auth/reader";
import { COOKIE_SECURE, readerCookieName } from "@/lib/config";
import { userFromRequest } from "@/lib/auth/user-session";
import { findCodeByHash, getBookBySlug, upgradeCodeHash } from "@/lib/db/repo";
import { addCodeGrant } from "@/lib/db/users";
import { guardOrigin, jsonError, parseBody, safe } from "@/lib/http";
import type { AccessCode } from "@/lib/types";

const schema = z.object({ code: z.string().min(1).max(40) });

export const POST = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const key = `code:${clientIp(req)}`;
  if (isLimited(key)) {
    const mins = Math.max(1, Math.ceil(retryAfterSec(key) / 60));
    return jsonError(429, `Demasiados intentos. Vuelve a intentarlo en ${mins} ${mins === 1 ? "minuto" : "minutos"}.`);
  }
  const body = await parseBody(req, schema);
  const { slug } = await params;
  if (!body) return jsonError(400, "Solicitud no válida");

  const book = await getBookBySlug(slug);
  let code: AccessCode | null = null;
  let upgradeTo = ""; // set when the code matched only by its old SHA-256 hash
  if (book && book.status === "published") {
    for (const c of codeCandidates(body.code)) {
      code = await findCodeByHash(book.id, hashCode(c));
      if (!code) {
        code = await findCodeByHash(book.id, legacyHashCode(c));
        if (code) upgradeTo = hashCode(c);
      }
      if (code) break;
    }
  }
  if (!book || !code) {
    recordFailure(key);
    return jsonError(401, "Código incorrecto");
  }
  if (code.revoked || (code.expires_at && Date.parse(code.expires_at) <= Date.now())) {
    recordFailure(key);
    return jsonError(401, "Este código ha caducado o ya no está activo");
  }
  if (upgradeTo) await upgradeCodeHash(code.id, upgradeTo);
  // Signed in: keep this book on the account (for as long as the code stays valid).
  const session = await userFromRequest(req);
  if (session) await addCodeGrant(session.user.id, book.id, code.id);
  const { token, maxAge } = await signReader(book, code);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(readerCookieName(book.id), token, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/", maxAge,
  });
  return res;
});
