import { RETENTION_MS } from "@/lib/contact";
import { purgeOlderThan } from "@/lib/db/users";
import { guardAdmin, guardOrigin, ok, safe } from "@/lib/http";

const g = globalThis as unknown as { __retentionAt?: number };
const EVERY_MS = 24 * 60 * 60_000;

// Admin only: deletes download-history rows and contact messages older than 12 months (what /privacidad promises).
// The admin page calls it when it opens; it runs at most once a day per server instance and writes only when there is
// something to delete.
export const POST = safe(async (req: Request) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (g.__retentionAt && Date.now() - g.__retentionAt < EVERY_MS) return ok({ skipped: true, downloads: 0, messages: 0 });
  const r = await purgeOlderThan(RETENTION_MS);
  g.__retentionAt = Date.now();
  return ok({ skipped: false, ...r });
});
