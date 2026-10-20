import { downloadsAvailable } from "@/lib/db/users";
import { queryLog, toCsv } from "@/lib/downloads-log";
import { guardAdmin, jsonError, safe } from "@/lib/http";

const q = (u: URL, k: string) => u.searchParams.get(k) || undefined;

// CSV of the log with the same filters as the screen. UTF-8 with BOM, so Excel shows the accents correctly.
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  if (!(await downloadsAvailable())) return jsonError(404, "No encontrado");
  const u = new URL(req.url);
  const { all } = await queryLog({ user: q(u, "user"), book: q(u, "book"), from: q(u, "from"), to: q(u, "to") });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(all), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="descargas-${day}.csv"`, "Cache-Control": "no-store" },
  });
});
