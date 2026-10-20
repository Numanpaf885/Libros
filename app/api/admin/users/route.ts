import { z } from "zod";
import { formatSetupCode, generateSetupCode, hashSetupCode } from "@/lib/auth/codes";
import { adminUserViews } from "@/lib/auth/admin-users";
import { listBooks } from "@/lib/db/repo";
import { createUser, downloadsAvailable, getUserByUsername, listUsers } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, parseBody, safe } from "@/lib/http";
import { SETUP_CODE_TTL_MS } from "@/lib/config";
import { isReplacement } from "@/lib/books";


const booksField = z.union([z.literal("all"), z.array(z.string().uuid()).max(500)]);
const create = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
  display_name: z.string().trim().min(1).max(60),
  books: booksField,
});

export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const books = (await listBooks()).filter((b) => !isReplacement(b));
  const users = (await listUsers()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return ok({ users: await adminUserViews(users, books), downloads_available: await downloadsAvailable() });
});

// The plain activation code exists only in this response; the sheet keeps its HMAC.
export const POST = safe(async (req: Request) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const body = await parseBody(req, create);
  if (!body) return jsonError(400, "Usuario no válido: 3 a 32 caracteres (letras minúsculas, números, punto, guion o guion bajo) y un nombre.");
  if (await getUserByUsername(body.username)) return jsonError(409, "Ese usuario ya existe.");
  if (body.books !== "all") {
    const have = new Set((await listBooks()).map((b) => b.id));
    if (body.books.some((id) => !have.has(id))) return jsonError(400, "Algún libro ya no existe.");
  }
  const code = generateSetupCode();
  const expires = new Date(Date.now() + SETUP_CODE_TTL_MS).toISOString();
  const user = await createUser({ username: body.username, display_name: body.display_name, setup_code_hash: hashSetupCode(code), setup_code_expires_at: expires, books: body.books });
  return ok({ id: user.id, username: user.username, display_name: user.display_name, code: formatSetupCode(code), expires_at: expires }, { status: 201 });
});
