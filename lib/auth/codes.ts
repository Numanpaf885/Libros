import { createHash, createHmac, randomInt } from "node:crypto";
import { hashPepper } from "../config";

// No 0/O/1/I/L/U look-alikes.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function generateCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
/** Case-insensitive; whitespace is ignored. Hyphens are kept (custom codes may contain them). */
export const normalizeCode = (c: string) => c.toUpperCase().replace(/\s+/g, "");
/** What a reader typed, then the same without hyphens (generated codes are shown as XXXXX-XXXXX). */
export function codeCandidates(c: string): string[] {
  const n = normalizeCode(c);
  const s = n.replace(/-/g, "");
  return n === s ? [n] : [n, s];
}
/** Current hash: HMAC-SHA-256 keyed with HASH_PEPPER. Used for every new or changed code. */
export const hashCode = (c: string) => createHmac("sha256", hashPepper()).update(normalizeCode(c)).digest("hex");
/** Old unkeyed hash. Only used to recognise codes stored before the pepper existed (they are upgraded on first use). */
export const legacyHashCode = (c: string) => createHash("sha256").update(normalizeCode(c)).digest("hex");
/** Both hashes of a plain code, so a uniqueness check covers old and new rows. */
export const hashesOf = (c: string): string[] => [hashCode(c), legacyHashCode(c)];
export const formatCode = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

/** Admin-chosen codes: 6-32 characters, letters, digits and hyphens. Returns the uppercased code or null. */
export const CUSTOM_CODE_RE = /^[A-Za-z0-9-]{6,32}$/;
export function parseCustomCode(raw: string): string | null {
  const t = raw.trim();
  return CUSTOM_CODE_RE.test(t) ? t.toUpperCase() : null;
}
export const CUSTOM_CODE_HELP = "El código debe tener entre 6 y 32 caracteres: solo letras, números y guiones.";

/** One-time user setup codes: 12 characters, shown as XXXX-XXXX-XXXX. */
export function generateSetupCode(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
export const formatSetupCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
/** Whatever the person typed (spaces, hyphens, lower case) -> the 12 plain characters. */
export const normalizeSetupCode = (c: string) => c.toUpperCase().replace(/[\s-]+/g, "");
export const hashSetupCode = (c: string) => hashCode(normalizeSetupCode(c));
