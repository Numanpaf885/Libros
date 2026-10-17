import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { isAdminRequest } from "./auth/admin";

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
export async function guardAdmin(req: Request): Promise<NextResponse | null> {
  return (await isAdminRequest(req)) ? null : jsonError(401, "No autorizado");
}
/** Wrap handlers so unexpected errors never leak details. */
export function safe<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      console.error(e);
      return jsonError(500, "Algo ha salido mal. Inténtalo de nuevo.");
    }
  };
}
