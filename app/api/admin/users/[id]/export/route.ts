import { z } from "zod";
import { listBooks } from "@/lib/db/repo";
import { bookmarksOfUser, getUserById, listDownloads, listMessages, passkeysOf, progressOf, userBookGrants } from "@/lib/db/users";
import { guardAdmin, jsonError, safe } from "@/lib/http";
import { ALL_BOOKS } from "@/lib/types";

// Admin only ("Exportar datos", right of access / portability): everything stored about one account, as a JSON file.
// Never a hash: no password, activation-code or IP hash, and no passkey key material.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const u = id.success ? await getUserById(id.data) : null;
  if (!u) return jsonError(404, "No encontrado");
  const titles = new Map((await listBooks()).map((b) => [b.id, b.title]));
  const book = (bookId: string) => (bookId === ALL_BOOKS ? "Todos los libros" : titles.get(bookId) ?? "(libro eliminado)");
  const data = {
    exported_at: new Date().toISOString(),
    account: {
      id: u.id, username: u.username, display_name: u.display_name, status: u.status, created_at: u.created_at, last_login_at: u.last_login_at,
      can_download: u.can_download,
      books: (await userBookGrants(u.id)).map((g) => ({ book: book(g.book_id), via: g.source === "code" ? "código de acceso" : "asignado por el administrador", granted_at: g.granted_at })),
    },
    passkeys: (await passkeysOf(u.id)).map((p) => ({ label: p.label, created_at: p.created_at, last_used_at: p.last_used_at })),
    progress: (await progressOf(u.id)).map((p) => ({ book: book(p.book_id), page: p.page, updated_at: p.updated_at })),
    bookmarks: (await bookmarksOfUser(u.id)).map((b) => ({ book: book(b.book_id), page: b.page, label: b.label, created_at: b.created_at })),
    downloads: (await listDownloads()).filter((d) => d.actor === "user" && d.user_id === u.id).map((d) => ({
      book: d.book_title, from_page: d.from_page, to_page: d.to_page, page_count: d.page_count, device: d.device, status: d.status, method: d.method, created_at: d.created_at, finished_at: d.finished_at,
    })),
    messages: (await listMessages()).filter((m) => m.user_id === u.id).map((m) => ({
      created_at: m.created_at, name: m.name, email: m.email, subject: m.subject, message: m.message, status: m.status, replied_at: m.replied_at, admin_note: m.admin_note,
    })),
  };
  const name = `datos-${u.username.replace(/[^\w.-]/g, "_")}-${data.exported_at.slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});
