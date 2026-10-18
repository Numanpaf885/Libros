import { z } from "zod";
import { listBooks } from "@/lib/db/repo";
import { deleteUserCascade, getUserById, modifyUser, setAdminBooks } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

const idOk = z.string().uuid();
const patch = z.union([
  z.object({ books: z.union([z.literal("all"), z.array(z.string().uuid()).max(500)]) }),
  z.object({ disabled: z.boolean() }),
]);

export const PATCH = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const body = await parseBody(req, patch);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  if (!(await getUserById(id.data))) return jsonError(404, "No encontrado");
  if ("books" in body) {
    if (body.books !== "all") {
      const have = new Set((await listBooks()).map((b) => b.id));
      if (body.books.some((b) => !have.has(b))) return jsonError(400, "Algún libro ya no existe.");
    }
    await setAdminBooks(id.data, body.books);
  } else {
    // Enabling gives back "active" if the person had set a password, otherwise "pending".
    await modifyUser(id.data, (u) => ({ ...u, status: body.disabled ? "disabled" : u.password_hash ? "active" : "pending" }));
  }
  return ok();
});

const del = z.object({ username: z.string().max(64) });
export const DELETE = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const body = await parseBody(req, del);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  const u = await getUserById(id.data);
  if (!u) return jsonError(404, "No encontrado");
  if (body.username.trim().toLowerCase() !== u.username) return jsonError(400, "El nombre de usuario no coincide");
  await deleteUserCascade(u.id);
  return ok();
});
