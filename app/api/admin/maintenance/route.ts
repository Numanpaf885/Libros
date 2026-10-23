import { overLimit } from "@/lib/auth/ratelimit";
import { applySheetSchema, readSheetStatus } from "@/lib/db/maintenance";
import { guardAdmin, guardOrigin, jsonError, ok, safe } from "@/lib/http";

// Admin only ("Mantenimiento"). Both answers hold tab and column names only: never ids, keys or data rows.

// The "Estado" table: each tab, its header row, and the expected columns that are missing. Read only (two sheet reads).
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  if (overLimit("maintenance:status", 20, 60_000)) return jsonError(429, "Demasiadas solicitudes. Espera un momento.");
  return ok({ tabs: await readSheetStatus() });
});

// "Actualizar base de datos": what `npm run setup-sheet` does. Creates the missing tabs and appends the missing header
// names at the END of row 1. It never reorders, renames or deletes anything and never touches a data row, so a second
// run changes nothing. At most 3 runs a minute (they cost Google Sheets quota).
export const POST = safe(async (req: Request) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (overLimit("maintenance:update", 3, 60_000)) {
    const res = jsonError(429, "Has actualizado varias veces seguidas. Espera un minuto y vuelve a probar.");
    res.headers.set("Retry-After", "60");
    return res;
  }
  const { changes, status } = await applySheetSchema();
  return ok({ changes, tabs: status });
});
