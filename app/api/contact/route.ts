import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clientIp, overLimit } from "@/lib/auth/ratelimit";
import { userFromRequest } from "@/lib/auth/user-session";
import { LIMITS, MIN_FILL_MS, SUBJECTS } from "@/lib/contact";
import { cleanText, formAge, ipHash } from "@/lib/contact-server";
import { addMessage, listMessages, messagesAvailable } from "@/lib/db/users";
import { guardOrigin, jsonError, ok, safe } from "@/lib/http";

const TEN_MIN = 10 * 60_000;
const DAY = 24 * 60 * 60_000;
const body = z.object({
  name: z.string().max(400),
  email: z.string().max(400),
  subject: z.string().max(100),
  message: z.string().max(10_000),
  consent: z.boolean(),
  website: z.string().max(500).optional(), // the honeypot: people never see it, so it stays empty
  t: z.string().max(200),
});
const fields = z.object({
  name: z.string().trim().min(1, "Escribe tu nombre.").max(LIMITS.name, `El nombre puede tener como máximo ${LIMITS.name} caracteres.`),
  email: z.string().trim().max(LIMITS.email, `El email puede tener como máximo ${LIMITS.email} caracteres.`).email("Revisa el email: no parece válido."),
  subject: z.enum(SUBJECTS, { message: "Elige un asunto." }),
  message: z.string().trim().min(LIMITS.messageMin, `El mensaje tiene que tener al menos ${LIMITS.messageMin} caracteres.`).max(LIMITS.messageMax, `El mensaje puede tener como máximo ${LIMITS.messageMax} caracteres.`),
  consent: z.literal(true, { message: "Para enviar el mensaje tienes que aceptar la Política de privacidad." }),
});
const fail = (status: number, error: string, field?: string) => ok({ error, ...(field ? { field } : {}) }, { status });

// The contact form (/contacto). Public: Origin check, honeypot, a minimum time on the page, rate limits per IP and per
// account, and validation. The message is stored as typed (plain text, never a formula) in the `messages` tab.
export const POST = safe(async (req: Request) => {
  const denied = guardOrigin(req);
  if (denied) return denied;
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonError(400, "Solicitud no válida"); }
  const b = body.safeParse(raw);
  if (!b.success) return jsonError(400, "Solicitud no válida");
  if (!(await messagesAvailable())) return fail(503, "El formulario de contacto aún no está disponible. Inténtalo más tarde.");
  if (b.data.website) return fail(400, "No se ha podido enviar el mensaje.");
  const age = formAge(b.data.t);
  if (age === null) return fail(400, "La página ha caducado. Recárgala y vuelve a enviar el mensaje (lo que has escrito se conserva).");
  if (age < MIN_FILL_MS) return fail(429, "Has enviado el formulario demasiado rápido. Espera unos segundos y vuelve a intentarlo.");
  const f = fields.safeParse({ ...b.data, name: cleanText(b.data.name).replace(/\s+/g, " "), message: cleanText(b.data.message) });
  if (!f.success) {
    const issue = f.error.issues[0];
    return fail(400, issue.message, String(issue.path[0] ?? ""));
  }

  const s = await userFromRequest(req);
  const hash = ipHash(clientIp(req));
  const now = Date.now();
  const all = await listMessages();
  const recent = (since: number, match: (m: (typeof all)[number]) => boolean) => all.filter((m) => match(m) && Date.parse(m.created_at) >= since).length;
  // the sheet (all server instances, within the cache time) and this instance's own counter (at once)
  if (recent(now - TEN_MIN, (m) => m.ip_hash === hash) >= 3 || overLimit(`contact:ip:${hash}`, 3, TEN_MIN)) {
    return fail(429, "Has enviado varios mensajes seguidos. Espera unos minutos y vuelve a intentarlo.");
  }
  if (s && (recent(now - DAY, (m) => m.user_id === s.user.id) >= 5 || overLimit(`contact:user:${s.user.id}`, 5, DAY))) {
    return fail(429, "Has enviado 5 mensajes hoy. Podrás escribir de nuevo mañana.");
  }
  await addMessage({
    id: randomUUID(), created_at: new Date(now).toISOString(),
    name: f.data.name, email: f.data.email, subject: f.data.subject, message: f.data.message,
    user_id: s?.user.id ?? "", username: s?.user.username ?? "",
    status: "nuevo", admin_note: "", replied_at: "", ip_hash: hash,
  });
  return ok({ ok: true, email: f.data.email }, { status: 201 });
});
