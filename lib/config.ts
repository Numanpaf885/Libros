export const isMock = () => process.env.DATA_BACKEND === "mock";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (isMock() && process.env.NODE_ENV !== "production") {
      return new TextEncoder().encode("mock-only-insecure-session-secret-0123456789");
    }
    throw new Error("SESSION_SECRET must be set (>= 32 chars)");
  }
  return new TextEncoder().encode(s);
}

export const COOKIE_SECURE = process.env.NODE_ENV === "production";
export const ADMIN_COOKIE = "br_admin";
export const ADMIN_TTL_S = 8 * 60 * 60;
export const READER_TTL_S = 30 * 24 * 60 * 60;
export const SHEET_CACHE_MS = 60_000;
export const readerCookieName = (bookId: string) => `br_b_${bookId.replace(/-/g, "").slice(0, 16)}`;

export const USER_COOKIE = "br_u";
export const USER_TTL_S = 30 * 24 * 60 * 60;
/** How long the users / user_books / progress / passkeys snapshot may be reused (one batchGet per refresh). */
export const USERS_CACHE_MS = 45_000;
export const SETUP_CODE_TTL_MS = 72 * 60 * 60 * 1000;
export const SETUP_MAX_ATTEMPTS = 5;
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;
/** The server never writes the same user+book to the sheet more often than this, whatever the clients send. */
export const PROGRESS_WRITE_GAP_MS = 15_000;

/** Keyed hash secret for access codes and setup codes. */
export function hashPepper(): string {
  const p = process.env.HASH_PEPPER;
  if (!p || p.length < 32) {
    if (isMock() && process.env.NODE_ENV !== "production") return "mock-only-insecure-hash-pepper-0123456789abcdef";
    throw new Error("HASH_PEPPER must be set (>= 32 chars)");
  }
  return p;
}
