import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sessionSecret } from "../config";
import { GET_TTL_S, PUT_TTL_S } from "./constants";

const ROOT = path.join(process.cwd(), ".data", "blobs");
function safe(p: string): string {
  const full = path.resolve(ROOT, p);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("bad path");
  return full;
}

// Local stand-in for R2 presigned URLs: HMAC over method + key + expiry.
const mac = (method: string, key: string, exp: number) =>
  createHmac("sha256", sessionSecret()).update(`${method}\n${key}\n${exp}`).digest("base64url");

function sign(method: "GET" | "PUT", key: string, ttl: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `/api/storage/local?k=${encodeURIComponent(key)}&e=${exp}&s=${mac(method, key, exp)}`;
}
export async function presignPut(key: string) {
  return sign("PUT", key, PUT_TTL_S);
}
export async function presignGet(key: string, ttl = GET_TTL_S) {
  return sign("GET", key, ttl);
}
/** Used by /api/storage/local. */
export function verifySigned(method: "GET" | "PUT", key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(mac(method, key, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function readLocal(key: string): fs.ReadStream | null {
  const f = safe(key);
  return fs.existsSync(f) ? fs.createReadStream(f) : null;
}
export function writeLocal(key: string, data: Buffer) {
  const f = safe(key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
}
export async function list(prefix: string): Promise<string[]> {
  const dir = safe(prefix);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((n) => `${prefix}/${n}`);
}
export async function deletePrefix(prefix: string): Promise<number> {
  const dir = safe(prefix);
  if (!fs.existsSync(dir)) return 0;
  const n = fs.readdirSync(dir).length;
  fs.rmSync(dir, { recursive: true, force: true });
  return n;
}
