import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CUSTOM_CODE_HELP, formatCode, generateCode, hashCode, parseCustomCode } from "@/lib/auth/codes";
import { addCodes, getBookById, listCodes } from "@/lib/db/repo";
import { guardAdmin, jsonError, ok, parseBody, safe } from "@/lib/http";
import type { AdminCode } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const idOk = z.string().uuid();

export const GET = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  if (!id.success || !(await getBookById(id.data))) return jsonError(404, "No encontrado");
  const codes: AdminCode[] = (await listCodes(id.data)).map((c) => ({
    id: c.id, label: c.label, created_at: c.created_at, expires_at: c.expires_at, revoked: c.revoked,
  }));
  return ok({ codes });
});

const gen = z.object({
  count: z.number().int().min(1).max(100).default(1),
  labels: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  label: z.string().trim().max(100).default(""),
  // Admin-chosen codes. When present, these are used instead of random ones.
  custom: z.array(z.object({ code: z.string().max(100), label: z.string().trim().max(100).default("") })).min(1).max(50).optional(),
  expires_at: z.string().datetime().nullable().default(null),
});

// Plain codes are returned ONCE here (the sheet only stores the SHA-256 hash).
export const POST = safe(async (req: Request, { params }: Ctx) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = idOk.safeParse((await params).id);
  const body = await parseBody(req, gen);
  if (!id.success || !body) return jsonError(400, "Solicitud no válida");
  if (!(await getBookById(id.data))) return jsonError(404, "No encontrado");
  if (body.expires_at && Date.parse(body.expires_at) <= Date.now()) return jsonError(400, "La fecha de caducidad debe ser futura");

  const existing = new Set((await listCodes(id.data)).map((c) => c.code_hash));
  const now = new Date().toISOString();
  const rows: { plain: string; share: string; display: string; code: { id: string; book_id: string; code_hash: string; label: string; created_at: string; expires_at: string; revoked: boolean } }[] = [];
  const make = (plain: string, share: string, display: string, label: string) => {
    rows.push({ plain, share, display, code: { id: randomUUID(), book_id: id.data, code_hash: hashCode(plain), label, created_at: now, expires_at: body.expires_at ?? "", revoked: false } });
  };

  if (body.custom) {
    const seen = new Set<string>();
    for (const [i, c] of body.custom.entries()) {
      const code = parseCustomCode(c.code);
      if (!code) return jsonError(400, `${CUSTOM_CODE_HELP} (“${c.code.trim().slice(0, 40)}”)`);
      const h = hashCode(code);
      if (existing.has(h) || seen.has(h)) return jsonError(409, `El código ${code} ya existe en este libro.`);
      seen.add(h);
      make(code, code, code, c.label || `Lector ${i + 1}`);
    }
  } else {
    for (let i = 0; i < body.count; i++) {
      let plain = generateCode();
      while (existing.has(hashCode(plain))) plain = generateCode();
      const label = body.labels[i] || (body.label ? (body.count > 1 ? `${body.label} ${i + 1}` : body.label) : `Lector ${i + 1}`);
      make(plain, plain, formatCode(plain), label);
    }
  }
  await addCodes(rows.map((r) => r.code));
  return ok({ codes: rows.map((r) => ({ id: r.code.id, label: r.code.label, code: r.display, share_code: r.share })) }, { status: 201 });
});
