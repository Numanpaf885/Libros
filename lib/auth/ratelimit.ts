// In-memory limiter: 5 failures / 15 min per key. LIMITATION: state is per server
// instance and resets on cold start, so on Vercel it is best-effort, not a hard guarantee.
const WINDOW = 15 * 60_000;
const MAX = 5;
const store = (globalThis as unknown as { __rl?: Map<string, number[]> });
store.__rl ??= new Map();

function recent(key: string): number[] {
  const now = Date.now();
  const arr = (store.__rl!.get(key) ?? []).filter((t) => now - t < WINDOW);
  store.__rl!.set(key, arr);
  return arr;
}
export function isLimited(key: string): boolean {
  return recent(key).length >= MAX;
}
/** Seconds until the oldest counted failure leaves the window. */
export function retryAfterSec(key: string): number {
  const oldest = recent(key)[0];
  return oldest ? Math.max(1, Math.ceil((oldest + WINDOW - Date.now()) / 1000)) : 0;
}
export function recordFailure(key: string) {
  recent(key).push(Date.now());
}
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Counts a request against `key` and says whether it is over `max` per `windowMs` (in memory, per server instance). */
const hits = (globalThis as unknown as { __hits?: Map<string, number[]> });
hits.__hits ??= new Map();
export function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.__hits!.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.__hits!.set(key, arr);
  return arr.length > max;
}
