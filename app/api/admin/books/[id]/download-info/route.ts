import { z } from "zod";
import { getBookById } from "@/lib/db/repo";
import { downloadInfo } from "@/lib/downloads-original";
import { guardAdmin, jsonError, ok, safe } from "@/lib/http";

export const GET = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  const book = id.success ? await getBookById(id.data) : null;
  if (!book) return jsonError(404, "No encontrado");
  return ok(await downloadInfo(book));
});
