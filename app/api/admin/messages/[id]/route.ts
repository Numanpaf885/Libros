import { z } from "zod";
import { MESSAGE_STATUSES, messageView } from "@/lib/contact";
import { deleteMessage, messagesAvailable, modifyMessage } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const idOk = z.string().uuid();
const patch = z.object({
  status: z.enum(MESSAGE_STATUSES).optional(),
  admin_note: z.string().max(2000).optional(),
}).refine((b) => b.status !== undefined || b.admin_note !== undefined);

// Admin only: change a message's status ("respondido" also records when) or its private note; delete it.
export const PATCH = safe(async (req: Request, { params }: Ctx) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await messagesAvailable())) return jsonError(409, "Actualiza la base de datos en Mantenimiento.");
  const id = idOk.safeParse((await params).id);
  const b = await parseBody(req, patch);
  if (!id.success || !b) return jsonError(400, "Solicitud no válida");
  const saved = await modifyMessage(id.data, (m) => ({
    ...m,
    ...(b.status ? { status: b.status, replied_at: b.status === "respondido" ? (m.replied_at || new Date().toISOString()) : m.replied_at } : {}),
    ...(b.admin_note !== undefined ? { admin_note: b.admin_note.replace(/\r\n?/g, "\n") } : {}),
  }));
  if (!saved) return jsonError(404, "No encontrado");
  return ok({ message: messageView(saved) });
});

export const DELETE = safe(async (req: Request, { params }: Ctx) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await messagesAvailable())) return jsonError(409, "Actualiza la base de datos en Mantenimiento.");
  const id = idOk.safeParse((await params).id);
  if (!id.success) return jsonError(400, "Solicitud no válida");
  return (await deleteMessage(id.data)) ? ok() : jsonError(404, "No encontrado");
});
