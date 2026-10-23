import "server-only";
import { isMock } from "../config";
import { assertSafeConfig } from "../safety";
import { sheetStatus, updateSheet, type SheetAdmin } from "../sheet-schema";
import { mockSheetAdmin } from "./mock";
import { forgetReadCache } from "./repo";
import { forgetHeaders, sheetsAdmin } from "./sheets";
import { forgetSnapshot } from "./users";

const sheet = (): SheetAdmin => {
  assertSafeConfig();
  return isMock() ? mockSheetAdmin : sheetsAdmin();
};

/** The admin's "Estado" table: every tab of the schema, its header row and what is missing. Read only. */
export const readSheetStatus = () => sheetStatus(sheet());

let running: ReturnType<typeof updateSheet> | null = null;
/**
 * "Actualizar base de datos" (the same as `npm run setup-sheet`). One run at a time on this server instance, so a
 * double click can never append a column twice. Afterwards this instance forgets what it had cached about the sheet,
 * so new tabs and columns are used at once (other instances notice within a few minutes).
 */
export function applySheetSchema(): ReturnType<typeof updateSheet> {
  running ??= (async () => {
    try {
      const r = await updateSheet(sheet());
      if (r.changes.length) {
        forgetHeaders();
        forgetReadCache();
        forgetSnapshot();
      }
      return r;
    } finally {
      running = null;
    }
  })();
  return running;
}
