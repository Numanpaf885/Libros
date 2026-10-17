import { SignJWT, jwtVerify } from "jose";
import { ADMIN_COOKIE, ADMIN_TTL_S, sessionSecret } from "../config";

export async function signAdmin(username: string): Promise<string> {
  return new SignJWT({ role: "admin", sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_TTL_S}s`)
    .sign(sessionSecret());
}
export async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    return payload.role === "admin";
  } catch {
    return false;
  }
}
export function cookieFrom(req: Request, name: string): string | undefined {
  const h = req.headers.get("cookie");
  if (!h) return undefined;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
/** Defence in depth: route handlers re-check even though proxy.ts already gates /api/admin/*. */
export async function isAdminRequest(req: Request): Promise<boolean> {
  return verifyAdminToken(cookieFrom(req, ADMIN_COOKIE));
}
