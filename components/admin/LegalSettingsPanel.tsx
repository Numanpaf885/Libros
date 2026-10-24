"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";

export interface LegalInfo { owner: string; email: string; city: string; updated: string }
interface Res { available: boolean; legal?: LegalInfo; complete?: boolean }
const fmt = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");

/** "Ajustes legales": who is responsible for the site and how to reach them, shown on /privacidad, /cookies and /aviso-legal. */
export default function LegalSettingsPanel({ onSaved }: { onSaved: (complete: boolean) => void }) {
  const toast = useToast();
  const [res, setRes] = useState<Res | null>(null);
  const [form, setForm] = useState({ owner: "", email: "", city: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    api<Res>("/api/admin/settings").then((r) => {
      if (dead) return;
      setRes(r);
      if (r.legal) setForm({ owner: r.legal.owner, email: r.legal.email, city: r.legal.city });
    }).catch((e) => { if (!dead) setErr(errText(e)); });
    return () => { dead = true; };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api<Res>("/api/admin/settings", "PUT", form);
      setRes(r);
      onSaved(!!r.complete);
      toast("ok", "Datos legales guardados");
    } catch (x) { setErr(errText(x)); }
    setBusy(false);
  }

  if (!res) return err ? <p role="alert" className="err">{err}</p> : <div className="skeleton h-64 rounded-card" aria-label="Cargando" />;
  if (!res.available) return <div className="card p-6"><p className="text-[17px]" data-testid="legal-missing">Actualiza la base de datos en Mantenimiento.</p><p className="hint mt-1">Los datos legales se guardan en la pestaña «settings» de la hoja de cálculo.</p></div>;
  const updated = fmt(res.legal?.updated ?? "");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section aria-labelledby="legal-title" className="space-y-4" data-testid="legal-panel">
      <div>
        <h2 id="legal-title" className="text-2xl">Ajustes legales</h2>
        <p className="hint mt-1 max-w-2xl">Aparecen en <a href="/privacidad" className="underline underline-offset-4">Privacidad</a>, <a href="/cookies" className="underline underline-offset-4">Cookies</a> y <a href="/aviso-legal" className="underline underline-offset-4">Aviso legal</a>. Lo que dejes vacío no se muestra.</p>
      </div>
      <form onSubmit={save} className="card max-w-2xl space-y-4 p-5 sm:p-6" noValidate>
        <div>
          <label htmlFor="legal-owner" className="label">Responsable</label>
          <input id="legal-owner" value={form.owner} onChange={set("owner")} maxLength={160} className="field" autoComplete="name" />
          <p className="hint mt-1">Tu nombre y apellidos (o el de tu empresa), y el NIF si quieres que conste.</p>
        </div>
        <div>
          <label htmlFor="legal-email" className="label">Email de contacto</label>
          <input id="legal-email" type="email" value={form.email} onChange={set("email")} maxLength={120} className="field" autoComplete="email" inputMode="email" />
          <p className="hint mt-1">Donde los lectores pueden ejercer sus derechos sobre sus datos.</p>
        </div>
        <div>
          <label htmlFor="legal-city" className="label">Ciudad <span className="font-normal text-muted">(opcional)</span></label>
          <input id="legal-city" value={form.city} onChange={set("city")} maxLength={80} className="field" autoComplete="address-level2" />
        </div>
        <p className="tnum text-sm text-muted" data-testid="legal-updated">{updated ? `Última actualización: ${updated}` : "Todavía no se ha guardado."} La fecha se pone sola al guardar.</p>
        {err && <p role="alert" className="err">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}><Icon name="check" size={18} />{busy ? "Guardando…" : "Guardar"}</button>
      </form>
    </section>
  );
}
