import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// A real cost-12 hash, compared when the user is unknown or has no password so the response time does not reveal it.
let dummy: string | null = null;
export const dummyHash = () => (dummy ??= bcrypt.hashSync(randomBytes(16).toString("hex"), BCRYPT_COST));

const COMMON = new Set(`
password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword contrasena contrasena1 contrasena123 contraseña
contraseña1 contraseña123 0123456789 1234567890 12345678910 123456789012 qwertyuiop qwerty123 qwerty1234 qwertyuiop1 asdfghjkl
asdfghjkl1 zxcvbnm123 1q2w3e4r5t 1qaz2wsx3edc iloveyou1 iloveyou123 letmein123 welcome123 admin12345 administrator abc1234567
abcdefghij abcd123456 aaaaaaaaaa 1111111111 0000000000 1234512345 9876543210 987654321 football1 baseball1 monkey1234 dragon1234
sunshine12 princess12 superman12 trustno1234 changeme123 libros1234 libros12345 avionica123 avionica1234 tmc0tmc0tmc0 madrid1234
barcelona1 123456789a a123456789 1234567890a 12345678a1 contrasena12 miguel1234 alejandro1 carlos1234 123123123123 passwordpassword
`.split(/\s+/).filter(Boolean));

/** Returns a Spanish error message, or null when the password is acceptable. */
export function passwordProblem(pw: string, username = ""): string | null {
  const bytes = new TextEncoder().encode(pw).length;
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (bytes > 72) return "La contraseña es demasiado larga (máximo 72 caracteres).";
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return "Esa contraseña es demasiado común. Elige otra.";
  if (username && (low === username.toLowerCase() || (username.length >= 4 && low.includes(username.toLowerCase())))) {
    return "La contraseña no puede contener tu nombre de usuario.";
  }
  return null;
}
