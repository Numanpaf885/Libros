export class AuthError extends Error {}
/** Errors that came from our API, already translated. */
export class ApiError extends Error {}

// Generic server messages -> Spanish. Messages the server already sends in Spanish pass through.
const ES: Record<string, string> = {
  "No autorizado": "Tu sesión ha caducado. Vuelve a entrar.",
  "Invalid request": "Solicitud no válida",
  "Unauthorized": "Tu sesión ha caducado. Vuelve a entrar.",
  "Not found": "No encontrado",
  "Something went wrong": "Algo ha salido mal. Inténtalo de nuevo.",
  "Upload incomplete": "La subida no está completa",
  "Finish the upload first": "Termina primero la subida",
  "Title does not match": "El título no coincide",
  "Request failed": "No se pudo completar la solicitud",
};
const tr = (m: string) => ES[m] ?? m;

/**
 * No request to our own API may spin forever. Pages get the server's answer within ~9 s even when Google is down
 * (its own limits); this is the last resort for a dead connection, above every server path (completing an admin's
 * PDF upload may take R2 up to 30 s).
 */
export const API_TIMEOUT_MS = 60_000;
export const OFFLINE_TEXT = "No se ha podido conectar. Comprueba tu conexión e inténtalo de nuevo.";
export const SLOW_TEXT = "El servidor tarda demasiado en responder. Inténtalo de nuevo en unos segundos.";
/** fetch with a time limit; network failures and timeouts become Spanish ApiErrors. */
export async function request(url: string, init: RequestInit = {}, ms = API_TIMEOUT_MS): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (init.signal?.aborted) throw e; // the caller cancelled: not an error to show
    throw new ApiError((e as Error)?.name === "TimeoutError" ? SLOW_TEXT : OFFLINE_TEXT);
  }
}

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await request(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(ES["No autorizado"]);
  if (!res.ok) throw new ApiError(tr((data as { error?: string }).error ?? "Request failed"));
  return data as T;
}

/** Message to show for any caught error: our API's (already Spanish) text, or a generic Spanish line. */
export const errText = (e: unknown) =>
  e instanceof ApiError || e instanceof AuthError ? e.message : "Algo ha salido mal. Inténtalo de nuevo.";

/** Like `api`, but a 401 is a normal answer here (wrong password, wrong code): show the server's own Spanish text. */
export async function postJson<T = unknown>(url: string, body: unknown = {}, method = "POST"): Promise<T> {
  const res = await request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(tr((data as { error?: string }).error ?? "Request failed"));
  return data as T;
}
