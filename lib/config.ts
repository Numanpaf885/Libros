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
