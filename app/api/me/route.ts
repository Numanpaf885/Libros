import { publicUser } from "@/lib/auth/me";
import { renewIfNeeded, userFromRequest } from "@/lib/auth/user-session";
import { ok, safe } from "@/lib/http";

// Who am I? Also renews the 30-day cookie once it is a day old.
export const GET = safe(async (req: Request) => {
  const s = await userFromRequest(req);
  const res = ok({ user: s ? await publicUser(s.user) : null });
  await renewIfNeeded(res, s);
  return res;
});
