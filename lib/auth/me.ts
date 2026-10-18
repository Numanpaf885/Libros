import { passkeysOf } from "../db/users";
import type { UserRecord } from "../types";

/** The only user fields a browser ever receives. */
export async function publicUser(u: UserRecord) {
  return { id: u.id, username: u.username, display_name: u.display_name, passkeys: (await passkeysOf(u.id)).length };
}
export const GENERIC_LOGIN_ERROR = "Usuario o contraseña incorrectos";
export const BAD_SETUP_CODE = "El código no es válido o ha caducado. Pide uno nuevo al propietario.";
export const tooMany = (secs: number) => {
  const mins = Math.max(1, Math.ceil(secs / 60));
  return `Demasiados intentos. Vuelve a intentarlo en ${mins} ${mins === 1 ? "minuto" : "minutos"}.`;
};
/** Only same-site paths: "/cuenta" yes, "//evil.com" and "https://..." no. */
export const safeNext = (n: string | null | undefined) => (n && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : "/");
