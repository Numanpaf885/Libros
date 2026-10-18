import { z } from "zod";
import { formatSetupCode, generateSetupCode, hashSetupCode } from "@/lib/auth/codes";
import { SETUP_CODE_TTL_MS } from "@/lib/config";
import { deleteUserPasskeys, getUserById, modifyUser } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, safe } from "@/lib/http";

// New one-time code, password and passkeys cleared, status pending, every device signed out (session_version + 1).
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success || !(await getUserById(id.data))) return jsonError(404, "No encontrado");
  const code = generateSetupCode();
  const expires = new Date(Date.now() + SETUP_CODE_TTL_MS).toISOString();
  const u = await modifyUser(id.data, (x) => ({
    ...x, password_hash: "", status: "pending", setup_code_hash: hashSetupCode(code), setup_code_expires_at: expires,
    setup_attempts: 0, failed_logins: 0, locked_until: "", session_version: x.session_version + 1,
  }));
  if (!u) return jsonError(404, "No encontrado");
  await deleteUserPasskeys(id.data);
  return ok({ username: u.username, display_name: u.display_name, code: formatSetupCode(code), expires_at: expires });
});
