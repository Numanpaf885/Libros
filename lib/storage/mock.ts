import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
// The content type is checked by /api/storage/local from the kind of key (pages WebP, text chunks JSON).
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
export function readLocal(key: string, range?: { start: number; end: number }): fs.ReadStream | null {
  const f = safe(key);
  return fs.existsSync(f) ? fs.createReadStream(f, range) : null;
}
/** Size of a stored object (for Range requests), or null. */
export function sizeLocal(key: string): number | null {
  const f = safe(key);
  return fs.existsSync(f) ? fs.statSync(f).size : null;
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

export async function listSizes(prefix: string): Promise<Record<string, number>> {
  const dir = safe(prefix);
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir).map((n) => [`${prefix}/${n}`, fs.statSync(path.join(dir, n)).size]));
}
export async function head(key: string): Promise<number | null> {
  const f = safe(key);
  return fs.existsSync(f) ? fs.statSync(f).size : null;
}
export async function readText(key: string): Promise<string | null> {
  const f = safe(key);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}
export async function deleteKey(key: string): Promise<void> {
  fs.rmSync(safe(key), { force: true });
}
export async function presignDownload(key: string, filename: string, ttl = GET_TTL_S) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `/api/storage/local?k=${encodeURIComponent(key)}&e=${exp}&d=${encodeURIComponent(filename)}&s=${mac("GET", `${key}|d|${filename}`, exp)}`;
}
/** Used by /api/storage/local for a download URL (the filename is part of what is signed). */
export const verifyDownload = (key: string, filename: string, exp: number, sig: string) => verifySigned("GET", `${key}|d|${filename}`, exp, sig);

// ---- multipart (stand-in for R2's): parts are staged in .data/multipart/<uploadId>/ and joined on completion ----
const STAGE = path.join(process.cwd(), ".data", "multipart");
const UPLOAD_RE = /^[a-f0-9]{32}$/;
const stage = (uploadId: string) => {
  if (!UPLOAD_RE.test(uploadId)) throw new Error("bad upload id");
  return path.join(STAGE, uploadId);
};
export async function createMultipart(key: string): Promise<string> {
  const id = randomBytes(16).toString("hex");
  fs.mkdirSync(stage(id), { recursive: true });
  fs.writeFileSync(path.join(stage(id), "key"), key);
  return id;
}
export async function presignPart(key: string, uploadId: string, part: number) {
  const exp = Math.floor(Date.now() / 1000) + PUT_TTL_S;
  return `/api/storage/local?k=${encodeURIComponent(key)}&u=${uploadId}&n=${part}&e=${exp}&s=${mac("PUT", `${key}|${uploadId}|${part}`, exp)}`;
}
export const verifyPart = (key: string, uploadId: string, part: number, exp: number, sig: string) => verifySigned("PUT", `${key}|${uploadId}|${part}`, exp, sig);
/** Used by /api/storage/local: stores one part and returns its ETag (quoted MD5, like S3). */
export function writePart(key: string, uploadId: string, part: number, data: Buffer): string | null {
  const d = stage(uploadId);
  if (!fs.existsSync(d) || fs.readFileSync(path.join(d, "key"), "utf8") !== key) return null;
  fs.writeFileSync(path.join(d, `p${part}`), data);
  return `"${createHash("md5").update(data).digest("hex")}"`;
}
export async function listParts(key: string, uploadId: string) {
  const d = stage(uploadId);
  if (!fs.existsSync(d) || fs.readFileSync(path.join(d, "key"), "utf8") !== key) throw Object.assign(new Error("NoSuchUpload"), { code: 404 });
  return fs.readdirSync(d).filter((n) => /^p\d+$/.test(n)).map((n) => {
    const buf = fs.readFileSync(path.join(d, n));
    return { part: Number(n.slice(1)), size: buf.length, etag: `"${createHash("md5").update(buf).digest("hex")}"` };
  }).sort((a, b) => a.part - b.part);
}
export async function completeMultipart(key: string, uploadId: string, parts: { part: number; etag: string }[]) {
  const have = new Map((await listParts(key, uploadId)).map((p) => [p.part, p.etag]));
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  if (!sorted.length || sorted.some((p, i) => p.part !== i + 1 || have.get(p.part) !== p.etag)) throw Object.assign(new Error("InvalidPart"), { code: 400 });
  const f = safe(key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "");
  for (const p of sorted) fs.appendFileSync(f, fs.readFileSync(path.join(stage(uploadId), `p${p.part}`)));
  fs.rmSync(stage(uploadId), { recursive: true, force: true });
}
export async function abortMultipart(_key: string, uploadId: string) {
  fs.rmSync(stage(uploadId), { recursive: true, force: true });
}
