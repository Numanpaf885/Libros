import { NextResponse } from "next/server";
import { ADMIN_COOKIE, COOKIE_SECURE } from "@/lib/config";

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
