import { createHash, randomInt } from "node:crypto";

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
export const hashCode = (c: string) => createHash("sha256").update(normalizeCode(c)).digest("hex");
export const formatCode = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

/** Admin-chosen codes: 6-32 characters, letters, digits and hyphens. Returns the uppercased code or null. */
export const CUSTOM_CODE_RE = /^[A-Za-z0-9-]{6,32}$/;
export function parseCustomCode(raw: string): string | null {
  const t = raw.trim();
  return CUSTOM_CODE_RE.test(t) ? t.toUpperCase() : null;
}
export const CUSTOM_CODE_HELP = "El código debe tener entre 6 y 32 caracteres: solo letras, números y guiones.";
