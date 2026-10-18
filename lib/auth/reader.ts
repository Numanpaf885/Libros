import { SignJWT, jwtVerify } from "jose";
import { READER_TTL_S, readerCookieName, sessionSecret } from "../config";
import { getBookBySlug, getCode } from "../db/repo";
import type { AccessCode, Book } from "../types";
import { cookieFrom } from "./admin";
import { userCanRead } from "./access";
import { userFromRequest } from "./user-session";

export async function signReader(book: Book, code: AccessCode): Promise<{ token: string; maxAge: number }> {
  let maxAge = READER_TTL_S;
  if (code.expires_at) {
    const left = Math.floor((Date.parse(code.expires_at) - Date.now()) / 1000);
    maxAge = Math.min(maxAge, left);
  }
  const token = await new SignJWT({ bid: book.id, cid: code.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.max(maxAge, 1)}s`)
    .sign(sessionSecret());
  return { token, maxAge };
}

export interface ReaderSession {
  book: Book;
  /** The access code behind the book cookie, or null when a signed-in account gives the access. */
  code: AccessCode | null;
}
/** Signature + live re-check of the code (revoked / expired / replaced) against the sheet cache. */
export async function verifyReaderToken(book: Book, token: string | undefined): Promise<AccessCode | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (payload.bid !== book.id || typeof payload.cid !== "string") return null;
    const code = await getCode(payload.cid);
    if (!code || code.book_id !== book.id || code.revoked) return null;
    if (code.expires_at && Date.parse(code.expires_at) <= Date.now()) return null;
    return code;
  } catch {
    return null;
  }
}

export async function readerSession(req: Request, slug: string): Promise<ReaderSession | null> {
  const book = await getBookBySlug(slug);
  if (!book || book.status !== "published") return null;
  const code = await verifyReaderToken(book, cookieFrom(req, readerCookieName(book.id)));
  if (code) return { book, code };
  // No valid code cookie: a signed-in reader may still have the book through their account.
  const u = await userFromRequest(req);
  return u && (await userCanRead(u.user, book)) ? { book, code: null } : null;
}
