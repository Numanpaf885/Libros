import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { sessionSecret } from "./config";

/** A download token is good for this long; the sessions of a long download keep asking for fresh page URLs with it. */
export const DOWNLOAD_TOKEN_TTL_S = 60 * 60;
export const MAX_DOWNLOAD_PAGES = 1000;
export const MAX_DOWNLOADS_PER_HOUR = 5;

export interface DownloadClaims { did: string; uid: string; bid: string; from: number; to: number }

/** Binds a download to one user, one book and one page range. */
export async function signDownloadToken(c: DownloadClaims): Promise<string> {
  return new SignJWT({ role: "download", did: c.did, bid: c.bid, from: c.from, to: c.to })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.uid)
    .setIssuedAt()
    .setExpirationTime(`${DOWNLOAD_TOKEN_TTL_S}s`)
    .sign(sessionSecret());
}
export async function verifyDownloadToken(token: string): Promise<DownloadClaims | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (payload.role !== "download" || typeof payload.sub !== "string" || typeof payload.did !== "string" || typeof payload.bid !== "string") return null;
    if (!Number.isInteger(payload.from) || !Number.isInteger(payload.to)) return null;
    return { did: payload.did, uid: payload.sub, bid: payload.bid, from: payload.from as number, to: payload.to as number };
  } catch {
    return null;
  }
}

export const deviceOf = (req: Request): "Móvil" | "Ordenador" =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(req.headers.get("user-agent") ?? "") ? "Móvil" : "Ordenador";
