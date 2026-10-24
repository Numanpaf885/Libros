import { z } from "zod";
import { saveSettings, settingsAvailable } from "@/lib/db/users";
import { guardAdmin, guardOrigin, jsonError, ok, safe } from "@/lib/http";
import { getLegal, LEGAL_KEYS } from "@/lib/legal";

const one = (max: number) => z.string().max(max).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim());
const body = z.object({
  owner: one(160),
  email: one(120).refine((s) => s === "" || z.string().email().safeParse(s).success, "Revisa el email: no parece válido."),
  city: one(80),
});

// Admin only ("Ajustes legales"): the owner, contact email and city shown on /privacidad, /cookies and /aviso-legal.
// "Última actualización" is set to today on every save.
export const GET = safe(async (req: Request) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  if (!(await settingsAvailable())) return ok({ available: false });
  const legal = await getLegal();
  return ok({ available: true, legal, complete: !!(legal.owner && legal.email) });
});

export const PUT = safe(async (req: Request) => {
  const denied = (await guardAdmin(req)) ?? guardOrigin(req);
  if (denied) return denied;
  if (!(await settingsAvailable())) return jsonError(409, "Actualiza la base de datos en Mantenimiento.");
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonError(400, "Solicitud no válida"); }
  const b = body.safeParse(raw);
  if (!b.success) return jsonError(400, b.error.issues[0]?.message?.startsWith("Revisa") ? b.error.issues[0].message : "Solicitud no válida");
  const today = new Date().toISOString().slice(0, 10);
  await saveSettings({ [LEGAL_KEYS.owner]: b.data.owner, [LEGAL_KEYS.email]: b.data.email, [LEGAL_KEYS.city]: b.data.city, [LEGAL_KEYS.updated]: today });
  const legal = await getLegal();
  return ok({ available: true, legal, complete: !!(legal.owner && legal.email) });
});
