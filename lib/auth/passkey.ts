import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { COOKIE_SECURE, sessionSecret } from "../config";
import { cookieFrom } from "./admin";
import { requestHost } from "./origin";

export const PASSKEY_COOKIE = "br_pk";
const CHALLENGE_TTL_S = 300;

/**
 * Hosts passkeys may be used on: localhost when developing; in production the project's production domain
 * (Vercel system variable, no protocol) plus anything listed in APP_ORIGIN (comma separated, with or without https://).
 */
export function allowedHosts(): string[] {
  const out: string[] = [];
  const add = (v: string | undefined) => {
    for (const part of (v ?? "").split(",")) {
      const t = part.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
      if (t) out.push(t);
    }
  };
  add(process.env.APP_ORIGIN);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (process.env.NODE_ENV !== "production") out.push("localhost");
  return out;
}
/** RP ID and origin for this request, or null when the host is not allowed. */
export function rpFor(req: Request): { rpID: string; origin: string } | null {
  const host = requestHost(req);
  const hostname = host.replace(/:\d+$/, "");
  const dev = process.env.NODE_ENV !== "production";
  const ok = allowedHosts().some((h) => (dev && h === "localhost" ? hostname === "localhost" : h === host || h === hostname));
  if (!ok) return null;
  const proto = hostname === "localhost" ? "http" : "https";
  return { rpID: hostname, origin: `${proto}://${host}` };
}

export const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

// The challenge travels in a short-lived signed HttpOnly cookie, so no server state is needed.
export async function setChallenge(res: NextResponse, challenge: string, kind: "reg" | "auth", userId = "") {
  const token = await new SignJWT({ ch: challenge, k: kind, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_S}s`)
    .sign(sessionSecret());
  res.cookies.set(PASSKEY_COOKIE, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict", path: "/api/me/passkeys", maxAge: CHALLENGE_TTL_S });
}
export async function readChallenge(req: Request, kind: "reg" | "auth"): Promise<{ challenge: string; userId: string } | null> {
  const t = cookieFrom(req, PASSKEY_COOKIE);
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, sessionSecret(), { algorithms: ["HS256"] });
    if (payload.k !== kind || typeof payload.ch !== "string") return null;
    return { challenge: payload.ch, userId: typeof payload.uid === "string" ? payload.uid : "" };
  } catch {
    return null;
  }
}
export function clearChallenge(res: NextResponse) {
  res.cookies.set(PASSKEY_COOKIE, "", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict", path: "/api/me/passkeys", maxAge: 0 });
}

/** "Chrome en Windows", "Safari en iPhone"... from the User-Agent, as a default device label. */
export function deviceLabel(ua: string | null): string {
  const u = ua ?? "";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : /Mac OS X/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux" : "";
  const br = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /(Chrome|CriOS)\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return br && os ? `${br} en ${os}` : os || br || "Este dispositivo";
}
