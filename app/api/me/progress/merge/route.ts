import { after } from "next/server";
import { z } from "zod";
import { readableBookIds } from "@/lib/auth/access";
import { userFromRequest } from "@/lib/auth/user-session";
import { listBooks } from "@/lib/db/repo";
import { drainProgress, mergeProgress } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ entries: z.array(z.object({ slug: z.string().min(1).max(200), page: z.number().int().min(1).max(100000) })).max(300) });

// On sign-in the device's own progress is merged into the account; the higher page wins.
export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const s = await userFromRequest(req);
  if (!s) return jsonError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  const body = await parseBody(req, schema);
  if (!body) return jsonError(400, "Solicitud no válida");
  const published = (await listBooks()).filter((b) => b.status === "published");
  const can = await readableBookIds(s.user, published);
  const bySlug = new Map(published.filter((b) => can.has(b.id)).map((b) => [b.slug, b]));
  const entries = body.entries.flatMap((e) => {
    const b = bySlug.get(e.slug);
    return b && e.page <= b.page_count ? [{ bookId: b.id, page: e.page }] : [];
  });
  const merged = await mergeProgress(s.user.id, entries);
  after(() => drainProgress());
  const progress: Record<string, number> = {};
  for (const b of bySlug.values()) if (merged[b.id]) progress[b.slug] = merged[b.id];
  return ok({ progress });
});
