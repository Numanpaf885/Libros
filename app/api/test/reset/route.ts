import { fakeSheetsUrl } from "@/lib/db/backend";
import { forgetReadCache } from "@/lib/db/repo";
import { resetSheetsForTests } from "@/lib/db/sheets";
import { forgetSnapshot } from "@/lib/db/users";
import { forgetHealth } from "@/lib/health";
import { jsonError, ok } from "@/lib/http";
import { assertSafeConfig } from "@/lib/safety";

export const dynamic = "force-dynamic";

// Tests only: e2e/resilience.mjs empties every cache between scenarios, like a brand-new server instance would be.
// It exists only in mock mode with the fake Google API (FAKE_SHEETS_URL), which is refused in production.
// ?scope=users forgets only the users cache (and the pause), to test a page that has some of its data cached.
export async function POST(req: Request) {
  if (!fakeSheetsUrl()) return jsonError(404, "No encontrado");
  assertSafeConfig();
  const usersOnly = new URL(req.url).searchParams.get("scope") === "users";
  resetSheetsForTests(usersOnly);
  if (!usersOnly) forgetReadCache();
  forgetSnapshot();
  forgetHealth();
  return ok();
}
