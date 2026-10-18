import { NextResponse } from "next/server";
import { clearUserCookie } from "@/lib/auth/user-session";
import { guardOrigin, safe } from "@/lib/http";

export const POST = safe(async (req: Request) => {
  const foreign = guardOrigin(req);
  if (foreign) return foreign;
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearUserCookie(res);
  return res;
});
