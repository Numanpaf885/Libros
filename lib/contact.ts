// The contact form's fields and limits, shared by the page, the API and the admin.
import type { MessageRecord } from "./types";

export const SUBJECTS = ["Acceso a un libro", "Problema técnico", "Sugerencia", "Otro"] as const;
export type Subject = (typeof SUBJECTS)[number];
export const LIMITS = { name: 80, email: 120, messageMin: 10, messageMax: 2000 } as const;
/** The form cannot be sent sooner than this after the page was loaded (people need longer; simple bots do not). */
export const MIN_FILL_MS = 3000;
export const MESSAGE_STATUSES = ["nuevo", "leído", "respondido", "archivado"] as const;
/** Downloads history and contact messages are kept this long (see /privacidad), then deleted. */
export const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** What the admin sees of a message: everything but the IP hash. */
export function messageView(m: MessageRecord): Omit<MessageRecord, "ip_hash"> {
  const v: Partial<MessageRecord> = { ...m };
  delete v.ip_hash;
  return v as Omit<MessageRecord, "ip_hash">;
}
