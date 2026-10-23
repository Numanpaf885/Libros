import { Readable } from "node:stream";
import { isMock } from "@/lib/config";
import { jsonError, ok, safe } from "@/lib/http";
import { OBJECT_RE, ORIGINAL_RE, TEXT_RE } from "@/lib/storage";
import { readLocal, sizeLocal, verifyDownload, verifyPart, verifySigned, writeLocal, writePart } from "@/lib/storage/mock";

// Mock-mode only: behaves like an R2 presigned URL. The signature IS the authorisation.
function parse(req: Request, method: "GET" | "PUT"): string | null {
  if (!isMock()) return null;
  const q = new URL(req.url).searchParams;
  const key = q.get("k") ?? "";
  if (!OBJECT_RE.test(key) || !verifySigned(method, key, Number(q.get("e")), q.get("s") ?? "")) return null;
  return key;
}

// The original PDF: a download URL (signed together with its filename) and the parts of a multipart upload.
function originalKey(req: Request, method: "GET" | "PUT"): string | null {
  if (!isMock()) return null;
  const q = new URL(req.url).searchParams;
  const key = q.get("k") ?? "";
  if (!ORIGINAL_RE.test(key)) return null;
  const exp = Number(q.get("e")), sig = q.get("s") ?? "";
  if (method === "GET") return verifyDownload(key, q.get("d") ?? "", exp, sig) ? key : null;
  return verifyPart(key, q.get("u") ?? "", Number(q.get("n")), exp, sig) ? key : null;
}

// Text chunks (JSON) and a plain read of the original PDF (no attachment name: "Extraer texto" reads it with Range requests).
function signedKey(req: Request, method: "GET" | "PUT", re: RegExp): string | null {
  if (!isMock()) return null;
  const q = new URL(req.url).searchParams;
  const key = q.get("k") ?? "";
  if (!re.test(key) || q.has("d") || q.has("u") || !verifySigned(method, key, Number(q.get("e")), q.get("s") ?? "")) return null;
  return key;
}
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function ranged(req: Request, key: string, type: string): Response {
  const size = sizeLocal(key);
  if (size === null) return jsonError(404, "No encontrado");
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m) {
    const start = Number(m[1]), end = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(readLocal(key, { start, end })!) as ReadableStream<Uint8Array>, {
      status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...NO_STORE },
    });
  }
  return new Response(Readable.toWeb(readLocal(key)!) as ReadableStream<Uint8Array>, { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", ...NO_STORE } });
}

export const GET = safe(async (req: Request) => {
  const text = signedKey(req, "GET", TEXT_RE);
  if (text) return ranged(req, text, "application/json");
  const orig = signedKey(req, "GET", ORIGINAL_RE);
  if (orig) return ranged(req, orig, "application/pdf");
  const dl = originalKey(req, "GET");
  if (dl) {
    const stream = readLocal(dl);
    if (!stream) return jsonError(404, "No encontrado");
    const name = (new URL(req.url).searchParams.get("d") ?? "libro.pdf").replace(/[^\w.-]/g, "_");
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const key = parse(req, "GET");
  if (!key) return jsonError(403, "Acceso denegado");
  const stream = readLocal(key);
  if (!stream) return jsonError(404, "No encontrado");
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

export const PUT = safe(async (req: Request) => {
  const text = signedKey(req, "PUT", TEXT_RE);
  if (text) {
    if (req.headers.get("content-type") !== "application/json") return jsonError(400, "Solicitud no válida");
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > 4 * 1024 * 1024) return jsonError(400, "Solicitud no válida");
    writeLocal(text, buf);
    return ok();
  }
  const orig = originalKey(req, "PUT");
  if (orig) {
    const q = new URL(req.url).searchParams;
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > 64 * 1024 * 1024) return jsonError(400, "Solicitud no válida");
    const etag = writePart(orig, q.get("u") ?? "", Number(q.get("n")), buf);
    if (!etag) return jsonError(404, "No encontrado");
    return new Response(null, { status: 200, headers: { ETag: etag, "Access-Control-Expose-Headers": "ETag" } });
  }
  const key = parse(req, "PUT");
  if (!key) return jsonError(403, "Acceso denegado");
  if (req.headers.get("content-type") !== "image/webp") return jsonError(400, "Solicitud no válida");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > 4 * 1024 * 1024) return jsonError(400, "Solicitud no válida");
  writeLocal(key, buf);
  return ok();
});
