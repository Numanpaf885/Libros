import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminToken } from "@/lib/auth/admin";
import { ADMIN_COOKIE } from "@/lib/config";

// Gate for /admin pages and /api/admin/*. Route handlers re-check too (defence in depth).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/admin/login";
  const authed = await verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);

  if (pathname.startsWith("/api/admin")) {
    if (!authed) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.next();
  }
  if (isLoginPage) {
    return authed ? NextResponse.redirect(new URL("/admin", req.url)) : NextResponse.next();
  }
  if (!authed) return NextResponse.redirect(new URL("/admin/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
