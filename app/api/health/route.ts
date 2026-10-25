import { isAdminRequest } from "@/lib/auth/admin";
import { checkHealth } from "@/lib/health";
import { ok, safe } from "@/lib/http";

export const dynamic = "force-dynamic";

// Is the site able to work? Public: only {ok} (503 when not, for uptime monitors). The signed-in admin also gets the
// details (Google Sheets reachable and its tabs, R2 reachable, response times), shown in Mantenimiento → "Estado del
// sistema"; ?fresh=1 checks again now. Results are reused for a few seconds so this URL cannot spend the sheet's quota.
export const GET = safe(async (req: Request) => {
  const admin = await isAdminRequest(req);
  const h = await checkHealth(admin && new URL(req.url).searchParams.get("fresh") === "1");
  return ok(admin ? h : { ok: h.ok }, { status: h.ok ? 200 : 503 });
});
