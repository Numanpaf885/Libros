/** Host the browser used to reach us (behind Vercel's proxy it arrives in x-forwarded-host). */
export function requestHost(req: Request): string {
  return (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
}

/**
 * CSRF check for POST/PATCH/DELETE: browsers always send Origin on those, so it has to be this site.
 * A request with no Origin is accepted only when the browser says it is same-origin (Sec-Fetch-Site).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req);
  } catch {
    return false;
  }
}
