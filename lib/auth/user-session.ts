import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { COOKIE_SECURE, sessionSecret, USER_COOKIE, USER_TTL_S } from "../config";
import { getUserById } from "../db/users";
import type { UserRecord } from "../types";
import { cookieFrom } from "./admin";
import { isUnavailable } from "../db/errors";

const RENEW_AFTER_S = 24 * 60 * 60;

async function signUser(user: Pick<UserRecord, "id" | "session_version">): Promise<string> {
  return new SignJWT({ role: "reader", sv: user.session_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${USER_TTL_S}s`)
    .sign(sessionSecret());
}
function setUserCookie(res: NextResponse, token: string) {
  res.cookies.set(USER_COOKIE, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: USER_TTL_S });
}
export function clearUserCookie(res: NextResponse) {
  res.cookies.set(USER_COOKIE, "", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: 0 });
}
export async function startSession(res: NextResponse, user: UserRecord) {
  setUserCookie(res, await signUser(user));
}

export interface UserSession {
  user: UserRecord;
  /** The token is older than a day: the caller should set a fresh cookie (sliding 30-day session). */
  renew: boolean;
}
/**
 * Signature, expiry, then the live checks against the cached users tab: the account must exist, be active and
 * carry the same session_version. Reset, disable and "sign out everywhere" therefore take effect within the cache time.
 */
export async function userFromToken(token: string | undefined): Promise<UserSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (payload.role !== "reader" || typeof payload.sub !== "string" || typeof payload.sv !== "number") return null;
    const user = await getUserById(payload.sub);
    if (!user || user.status !== "active" || user.session_version !== payload.sv) return null;
    const age = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);
    return { user, renew: age > RENEW_AFTER_S };
  } catch (e) {
    // the sheet not answering is not "signed out": the caller shows "Reintentar" (or renders without the account)
    if (isUnavailable(e)) throw e;
    return null;
  }
}
export const userFromRequest = (req: Request) => userFromToken(cookieFrom(req, USER_COOKIE));

/** Set a fresh cookie on a response when the session asks for it. */
export async function renewIfNeeded(res: NextResponse, s: UserSession | null) {
  if (s?.renew) await startSession(res, s.user);
}
