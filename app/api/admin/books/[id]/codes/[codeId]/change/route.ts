import { z } from "zod";
import { CUSTOM_CODE_HELP, formatCode, generateCode, hashCode, hashesOf, parseCustomCode } from "@/lib/auth/codes";
import { changeCode, getCode, listCodes } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";

const schema = z.object({ code: z.string().max(100).optional() }); // omitted = generate a random one

// New hash, same label/expiry. The row gets a new id, so every session signed in with the old
// code (its cookie carries the old id) fails its next page request.
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string; codeId: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const ids = z.object({ id: z.string().uuid(), codeId: z.string().uuid() }).safeParse(await params);
  const body = await parseBody(req, schema);
  if (!ids.success || !body) return jsonError(400, "Solicitud no válida");
  const current = await getCode(ids.data.codeId);
  if (!current || current.book_id !== ids.data.id) return jsonError(404, "No encontrado");
  if (current.revoked) return jsonError(400, "Restaura el código antes de cambiarlo.");

  const taken = new Set((await listCodes(ids.data.id)).map((c) => c.code_hash));
  let plain: string, share: string, display: string;
  if (body.code !== undefined && body.code.trim() !== "") {
    const code = parseCustomCode(body.code);
    if (!code) return jsonError(400, CUSTOM_CODE_HELP);
    if (hashesOf(code).some((x) => taken.has(x))) return jsonError(409, `El código ${code} ya existe en este libro.`);
    plain = share = display = code;
  } else {
    plain = generateCode();
    while (hashesOf(plain).some((x) => taken.has(x))) plain = generateCode();
    share = plain;
    display = formatCode(plain);
  }
  const next = await changeCode(current.id, hashCode(plain));
  if (!next) return jsonError(404, "No encontrado");
  return ok({ code: { id: next.id, label: next.label, code: display, share_code: share } });
});
