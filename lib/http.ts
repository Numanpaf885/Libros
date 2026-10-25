import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { isAdminRequest } from "./auth/admin";
import { sameOrigin } from "./auth/origin";
import { isUnavailable, MissingTabError, SheetsUnavailableError } from "./db/errors";

/** What a reader sees when Google Sheets or R2 does not answer in time (pages offer "Reintentar"). */
export const UNAVAILABLE_TEXT = "El servicio no responde ahora mismo. Inténtalo de nuevo en unos segundos.";

export const jsonError = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
export const ok = (data: unknown = { ok: true }, init?: ResponseInit) =>
  NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });

/** Parse + validate a JSON body. Returns null on any failure (caller returns generic 400). */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T | null> {
  try {
    const r = schema.safeParse(await req.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
/** CSRF guard for state-changing requests: the Origin header must be this site. */
export const guardOrigin = (req: Request): NextResponse | null =>
  sameOrigin(req) ? null : jsonError(403, "Solicitud no permitida");
export async function guardAdmin(req: Request): Promise<NextResponse | null> {
  return (await isAdminRequest(req)) ? null : jsonError(401, "No autorizado");
}
/**
 * Wrap handlers so unexpected errors never leak details. Google Sheets or R2 not answering in time is not a bug: it
 * answers 503 with Retry-After (the page offers "Reintentar"); a tab that does not exist yet answers 409.
 */
export function safe<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (isUnavailable(e)) {
        const s = Math.max(1, Math.ceil((e instanceof SheetsUnavailableError ? e.retryAfterMs : 5_000) / 1000));
        return NextResponse.json({ error: UNAVAILABLE_TEXT, retry: true }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(s) } });
      }
      if (e instanceof MissingTabError || (e as Error)?.name === "MissingTabError") return jsonError(409, "Actualiza la base de datos en Mantenimiento.");
      console.error(e);
      return jsonError(500, "Algo ha salido mal. Inténtalo de nuevo.");
    }
  };
}
