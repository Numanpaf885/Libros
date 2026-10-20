import { Readable } from "node:stream";
import { isMock } from "@/lib/config";
import { jsonError, ok, safe } from "@/lib/http";
import { OBJECT_RE, ORIGINAL_RE } from "@/lib/storage";
import { readLocal, verifyDownload, verifyPart, verifySigned, writeLocal, writePart } from "@/lib/storage/mock";

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

export const GET = safe(async (req: Request) => {
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
