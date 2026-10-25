"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { errText, request } from "@/lib/client/api";
import type { Health } from "@/lib/health";

const name = "rounded-[4px] bg-fg/[0.06] px-1.5 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]";
const Chip = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={`chip w-fit ${ok ? "chip-ok" : "border-danger text-danger"}`}>{ok ? yes : no}</span>;
const ms = (v: number | null) => (v === null ? "" : `${v.toLocaleString("es-ES")} ms`);
async function fetchHealth(fresh: boolean): Promise<Health> {
  // 503 (something is down) still carries the details for the admin
  const res = await request(`/api/health${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
  const data = (await res.json().catch(() => null)) as Health | null;
  if (!data || !("sheets" in data)) throw new Error("no details");
  return data;
}

/** Mantenimiento → "Estado del sistema": is Google Sheets answering (and with which tabs), is R2, how fast. */
export default function SystemStatus({ version = 0 }: { version?: number }) {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dead = false;
    fetchHealth(version > 0).then((d) => { if (!dead) { setH(d); setErr(""); } }).catch((e) => { if (!dead) setErr(errText(e)); });
    return () => { dead = true; };
  }, [version]);
  const recheck = async () => {
    setBusy(true);
    try { setH(await fetchHealth(true)); setErr(""); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  const s = h?.sheets;
  return (
    <section aria-labelledby="sys-title" className="card space-y-4 p-5 sm:p-7" data-testid="system-status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sys-title" className="text-2xl">Estado del sistema</h2>
          <p className="hint mt-1">Si la hoja de cálculo y el almacenamiento responden, y cuánto tardan.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={recheck} disabled={busy} aria-busy={busy}><Icon name="rotate" size={16} />Comprobar de nuevo</button>
      </div>
      {err && !h ? <p role="alert" className="err">{err}</p> : !h || !s ? (
        <div className="skeleton h-24 rounded-card" aria-label="Cargando" />
      ) : (
        <dl className="divide-y divide-line text-[15px]">
          <div className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid="status-sheets" data-ok={s.ok ? "1" : "0"}>
            <dt className="font-medium">Hoja de cálculo</dt>
            <dd className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip ok={s.ok} yes="Conectada" no="Con problemas" />
                {s.ms !== null && <span className="tnum text-muted">{ms(s.ms)}</span>}
                {s.tabs_found.length > 0 && <span className="text-muted">{s.tabs_found.length} de {s.tabs_found.length + s.tabs_missing.length} pestañas</span>}
                {h.backend !== "google" && <span className="text-muted">({h.backend === "mock" ? "datos de prueba" : "API de Google simulada"})</span>}
              </div>
              {s.error && <p className="text-danger">{s.error}{s.paused ? ` · se reintenta en ${s.paused.retry_in_s} s` : ""}</p>}
              {s.tabs_missing.length > 0 && (
                <p data-testid="status-missing-tabs">Faltan pestañas: {s.tabs_missing.map((t) => <code key={t} className={`${name} mr-1`}>{t}</code>)}<span className="text-muted">— pulsa «Actualizar base de datos».</span></p>
              )}
              {Object.keys(s.columns_missing).length > 0 && (
                <p>Faltan columnas: {Object.entries(s.columns_missing).map(([t, cols]) => <span key={t} className="mr-2"><code className={name}>{t}</code> ({cols.join(", ")})</span>)}</p>
              )}
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid="status-storage" data-ok={h.storage.ok ? "1" : "0"}>
            <dt className="font-medium">Almacenamiento (R2)</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Chip ok={h.storage.ok} yes="Conectado" no="Con problemas" />
              {h.storage.ms !== null && <span className="tnum text-muted">{ms(h.storage.ms)}</span>}
              {h.storage.error && <span className="text-danger">{h.storage.error}</span>}
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-medium">Datos de usuarios</dt>
            <dd className="text-muted">{h.users_cache_age_s === null ? "Todavía no se han leído en este servidor." : `Leídos hace ${h.users_cache_age_s} s${h.users_cache_age_s > 90 ? " (la hoja no responde: se usa la última copia)" : ""}.`}</dd>
          </div>
        </dl>
      )}
      {h && <p className="tnum text-sm text-muted">Comprobado a las {new Date(h.checked_at).toLocaleTimeString("es-ES")}.</p>}
    </section>
  );
}
