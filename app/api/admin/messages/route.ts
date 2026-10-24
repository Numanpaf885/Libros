import { listMessages, messagesAvailable } from "@/lib/db/users";
import { guardAdmin, ok, safe } from "@/lib/http";
import { messageView } from "@/lib/contact";

const SIZE = 50;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

// Admin only ("Mensajes"): newest first, filtered by status and by a search in the name, email, subject and text,
// 50 per page. `unread` (status "nuevo") feeds the badge in the admin navigation. Read from the cached snapshot.
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  if (!(await messagesAvailable())) return ok({ available: false, unread: 0, total: 0, page: 1, pages: 1, size: SIZE, rows: [] });
  const q = new URL(req.url).searchParams;
  const status = q.get("status") ?? "";
  const term = fold((q.get("q") ?? "").trim()).slice(0, 100);
  const all = (await listMessages()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = all.filter((m) => (!status || m.status === status) && (!term || fold(`${m.name}\n${m.email}\n${m.subject}\n${m.message}`).includes(term)));
  const size = Math.min(SIZE, Math.max(1, Math.floor(Number(q.get("size"))) || SIZE)); // size=1: just the counts (badge)
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(q.get("page")) || 1));
  return ok({
    available: true, unread: all.filter((m) => m.status === "nuevo").length, total: rows.length, page, pages, size,
    rows: rows.slice((page - 1) * size, page * size).map(messageView),
  });
});
