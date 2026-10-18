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
export const tr = (m: string) => ES[m] ?? m;

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
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
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(tr((data as { error?: string }).error ?? "Request failed"));
  return data as T;
}
