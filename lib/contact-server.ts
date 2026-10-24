import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPepper, sessionSecret } from "./config";

// The contact form's anti-spam helpers (no third party, nothing stored in the browser).

const sign = (t: number) => createHmac("sha256", sessionSecret()).update(`contact:${t}`).digest("base64url");
/** A signed "the form was loaded at" stamp, put in the page: the server checks it on submit. */
export const formToken = () => { const t = Date.now(); return `${t}.${sign(t)}`; };
/** Milliseconds since the form was loaded, or null when the stamp is forged or older than two hours. */
export function formAge(token: string): number | null {
  const m = /^(\d{13})\.([\w-]{43})$/.exec(token);
  if (!m) return null;
  const t = Number(m[1]);
  const a = Buffer.from(sign(t)), b = Buffer.from(m[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const age = Date.now() - t;
  return age >= 0 && age <= 2 * 60 * 60 * 1000 ? age : null;
}
/** HMAC of the IP with HASH_PEPPER: lets the rate limit and the admin recognise repeats without storing the IP. */
export const ipHash = (ip: string) => createHmac("sha256", hashPepper()).update(`ip:${ip}`).digest("hex").slice(0, 32);
/** Text as typed, minus control characters (new lines and tabs stay); Windows line ends become "\n". */
export const cleanText = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
