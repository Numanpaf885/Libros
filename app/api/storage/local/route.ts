import { Readable } from "node:stream";
import { isMock } from "@/lib/config";
import { jsonError, ok, safe } from "@/lib/http";
import { OBJECT_RE } from "@/lib/storage";
import { readLocal, verifySigned, writeLocal } from "@/lib/storage/mock";

// Mock-mode only: behaves like an R2 presigned URL. The signature IS the authorisation.
function parse(req: Request, method: "GET" | "PUT"): string | null {
  if (!isMock()) return null;
  const q = new URL(req.url).searchParams;
  const key = q.get("k") ?? "";
  if (!OBJECT_RE.test(key) || !verifySigned(method, key, Number(q.get("e")), q.get("s") ?? "")) return null;
  return key;
}

export const GET = safe(async (req: Request) => {
  const key = parse(req, "GET");
  if (!key) return jsonError(403, "Acceso denegado");
  const stream = readLocal(key);
  if (!stream) return jsonError(404, "No encontrado");
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

export const PUT = safe(async (req: Request) => {
  const key = parse(req, "PUT");
  if (!key) return jsonError(403, "Acceso denegado");
  if (req.headers.get("content-type") !== "image/webp") return jsonError(400, "Solicitud no válida");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > 4 * 1024 * 1024) return jsonError(400, "Solicitud no válida");
  writeLocal(key, buf);
  return ok();
});
