"use client";
import { useEffect, useState } from "react";
import ErrorState from "@/components/ui/ErrorState";
import SystemStatus from "./SystemStatus";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import type { Change, TabStatus } from "@/lib/sheet-schema";

const COLS = "md:grid md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,15rem)] md:items-start md:gap-4";
const name = "rounded-[4px] bg-fg/[0.06] px-1.5 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]";

function chipOf(t: TabStatus): [string, string] {
  if (!t.exists) return ["chip border-danger text-danger", "Falta la pestaña"];
  if (t.missing.length) return ["chip border-danger text-danger", t.missing.length === 1 ? "Falta 1 columna" : `Faltan ${t.missing.length} columnas`];
  return ["chip chip-ok", "Al día"];
}
/** Changes still to make: one per missing tab and one per missing column of an existing tab. */
const pendingOf = (tabs: TabStatus[]) => tabs.reduce((n, t) => n + (t.exists ? t.missing.length : 1), 0);

function Result({ changes }: { changes: Change[] }) {
  return (
    <div className="panel p-4" data-testid="maintenance-result">
      <h3 className="font-sans text-base font-semibold">Resultado</h3>
      {changes.length ? (
        <ul className="mt-2 space-y-1.5 text-[15px]">
          {changes.map((c) => (
            <li key={c.kind === "tab" ? `t:${c.tab}` : `c:${c.tab}:${c.column}`} className="flex items-start gap-2">
              <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
              {c.kind === "tab"
                ? <span>Pestaña <code className={name}>{c.tab}</code> creada</span>
                : <span>Columna <code className={name}>{c.column}</code> añadida <span className="text-muted">en {c.tab}</span></span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-[15px]"><Icon name="check" size={18} className="shrink-0 text-ok" />Todo al día</p>
      )}
    </div>
  );
}

/** Each tab of the sheet: its header row, and the expected columns it lacks. Read only. */
function StatusTable({ tabs }: { tabs: TabStatus[] }) {
  return (
    <div role="table" aria-label="Estado de la hoja de cálculo" className="md:card md:overflow-hidden" data-testid="maintenance-status">
      <div role="row" className={`hidden border-b border-line bg-surface/60 px-3 py-2.5 text-sm text-muted ${COLS}`}>
        <span role="columnheader">Pestaña</span><span role="columnheader">Columnas</span><span role="columnheader">Faltan</span>
      </div>
      <ul role="rowgroup" className="space-y-3 md:space-y-0">
        {tabs.map((t) => {
          const [chip, text] = chipOf(t);
          return (
            <li key={t.tab} role="row" data-tab={t.tab} className={`card p-4 text-[15px] md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:bg-transparent md:p-3 first:md:border-t-0 ${COLS}`}>
              <div role="cell" className="flex flex-wrap items-center justify-between gap-2 md:block">
                <span className="font-mono font-medium [overflow-wrap:anywhere]">{t.tab}</span>
                <span className={`${chip} w-fit md:mt-1.5 md:flex`}>{text}</span>
              </div>
              <div role="cell" className="mt-3 min-w-0 md:mt-0">
                <span className="mb-1 block text-sm text-muted md:hidden">Columnas</span>
                {t.exists && t.columns.length ? (
                  <span className="flex flex-wrap gap-1">{t.columns.map((c, i) => <code key={i} className={`${name} ${c ? "" : "text-muted"}`}>{c || "(vacía)"}</code>)}</span>
                ) : (
                  <span className="text-muted">{t.exists ? "Sin encabezados" : "La pestaña no existe todavía"}</span>
                )}
                {t.misplaced.length > 0 && (
                  <p className="mt-2 text-sm text-muted" data-testid="maintenance-order-note">Columnas en otro orden: no pasa nada, la aplicación las busca por su nombre.</p>
                )}
              </div>
              <div role="cell" className="mt-3 min-w-0 md:mt-0" data-col="missing">
                <span className="mb-1 block text-sm text-muted md:hidden">Faltan</span>
                {!t.exists ? (
                  <span className="text-danger">La pestaña entera ({t.missing.length} columnas)</span>
                ) : t.missing.length ? (
                  <span className="flex flex-wrap gap-1">{t.missing.map((c) => <code key={c} className={`${name} text-danger`}>{c}</code>)}</span>
                ) : (
                  <span className="text-muted">Nada</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Mantenimiento": brings the Google Sheet up to date with the app (what `npm run setup-sheet` does). */
export default function MaintenancePanel({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [tabs, setTabs] = useState<TabStatus[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState(0); // "Estado del sistema" checks again after an update
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    api<{ tabs: TabStatus[] }>("/api/admin/maintenance")
      .then((r) => { if (!dead) { setTabs(r.tabs); setLoadErr(""); } })
      .catch((e) => { if (!dead) setLoadErr(errText(e)); });
    return () => { dead = true; };
  }, [attempt]);

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ changes: Change[]; tabs: TabStatus[] }>("/api/admin/maintenance", "POST", {});
      setChanges(r.changes); setTabs(r.tabs); setLoadErr("");
      toast("ok", r.changes.length ? "Base de datos actualizada" : "Todo al día");
      if (r.changes.length) { onChanged?.(); setChecked((v) => v + 1); }
    } catch (e) {
      setErr(errText(e)); toast("error", errText(e));
    }
    setBusy(false);
  };
  const pending = tabs ? pendingOf(tabs) : 0;

  return (
    <div className="space-y-8">
      <SystemStatus version={checked} />
      <section aria-labelledby="maint-update" className="card space-y-5 p-5 sm:p-7">
        <div>
          <h2 id="maint-update" className="text-2xl">Base de datos</h2>
          <p className="hint mt-1 max-w-prose">Crea en la hoja de cálculo las pestañas y columnas que necesitan las funciones nuevas, igual que <code className={name}>npm run setup-sheet</code>. Las columnas se añaden siempre al final. Nunca cambia el orden, no renombra ni borra nada y no toca tus datos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" aria-busy={busy} disabled={busy} onClick={run} className="btn btn-primary">Actualizar base de datos</button>
          {tabs && !changes && (
            <span className="text-sm text-muted" data-testid="maintenance-pending">{pending ? (pending === 1 ? "Hay 1 cambio pendiente" : `Hay ${pending} cambios pendientes`) : "Todo al día"}</span>
          )}
        </div>
        {err && !busy && <p role="alert" className="err">{err}</p>}
        <div aria-live="polite">{changes && <Result changes={changes} />}</div>
        {changes && changes.length > 0 && <p className="hint">Las funciones que usan estas pestañas y columnas se activan al momento aquí; en el resto del sitio pueden tardar hasta 5 minutos.</p>}
      </section>

      <section aria-labelledby="maint-status" className="space-y-4">
        <div>
          <h2 id="maint-status" className="text-2xl">Estado</h2>
          <p className="hint mt-1">Lo que tiene ahora cada pestaña de la hoja y lo que le falta. Solo lectura.</p>
        </div>
        {loadErr ? <ErrorState title="No se ha podido leer la hoja de cálculo" text={loadErr} onRetry={() => { setLoadErr(""); setAttempt((a) => a + 1); }} />
          : tabs ? <StatusTable tabs={tabs} />
          : <div className="space-y-3" aria-label="Cargando"><div className="skeleton h-16 rounded-card" /><div className="skeleton h-16 rounded-card" /><div className="skeleton h-16 rounded-card" /></div>}
      </section>
    </div>
  );
}
