import "server-only";
import { getSettings, settingsNow } from "./db/users";

/** The legal details edited in the admin ("Ajustes legales"), kept in the `settings` tab under these keys. */
export const LEGAL_KEYS = { owner: "legal_owner", email: "legal_email", city: "legal_city", updated: "legal_updated" } as const;
export interface Legal { owner: string; email: string; city: string; updated: string }

const legalOf = (s: Record<string, string>): Legal => ({ owner: s[LEGAL_KEYS.owner] ?? "", email: s[LEGAL_KEYS.email] ?? "", city: s[LEGAL_KEYS.city] ?? "", updated: s[LEGAL_KEYS.updated] ?? "" });
/**
 * For the public pages (/privacidad, /cookies, /aviso-legal, the footer): never waits on the sheet. Cached values, or
 * empty ones (the pages then leave those lines out) when the sheet cannot be read right now.
 */
export async function getLegal(): Promise<Legal> {
  return legalOf(await settingsNow().catch(() => ({})));
}
/** For the admin's form: the stored values exactly (throws when the sheet cannot be read, so nothing is saved blank). */
export async function getLegalExact(): Promise<Legal> {
  return legalOf(await getSettings());
}
/** "23 de octubre de 2026" from "2026-10-23" ("" when there is no valid date). */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${Number(m[3])} de ${months[Number(m[2]) - 1] ?? ""} de ${m[1]}`;
}
