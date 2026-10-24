import "server-only";
import { getSettings } from "./db/users";

/** The legal details edited in the admin ("Ajustes legales"), kept in the `settings` tab under these keys. */
export const LEGAL_KEYS = { owner: "legal_owner", email: "legal_email", city: "legal_city", updated: "legal_updated" } as const;
export interface Legal { owner: string; email: string; city: string; updated: string }

/** The legal details; empty strings for what is missing (also when the tab does not exist yet). */
export async function getLegal(): Promise<Legal> {
  const s = await getSettings().catch(() => ({} as Record<string, string>));
  return { owner: s[LEGAL_KEYS.owner] ?? "", email: s[LEGAL_KEYS.email] ?? "", city: s[LEGAL_KEYS.city] ?? "", updated: s[LEGAL_KEYS.updated] ?? "" };
}
/** "23 de octubre de 2026" from "2026-10-23" ("" when there is no valid date). */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${Number(m[3])} de ${months[Number(m[2]) - 1] ?? ""} de ${m[1]}`;
}
