import { textColumnsReady } from "@/lib/db/repo";
import { guardAdmin, ok, safe } from "@/lib/http";

// Admin only: whether the sheet has the books.text_* / allow_copy columns (the text features stay hidden without them).
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  return ok({ ready: await textColumnsReady() });
});
