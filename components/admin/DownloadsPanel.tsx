"use client";
import { parseLabels, rangeText } from "@/lib/page-labels";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import type { DownloadRecord } from "@/lib/types";

export interface LogRow extends DownloadRecord { book_total: number | null; book_labels?: string }
interface LogResponse {
  available: boolean; total: number; page: number; pages: number; size: number; rows: LogRow[];
  filters: { users: { id: string; label: string }[]; books: { id: string; label: string }[]; has_admin: boolean };
}
export interface LogFilter { user?: string; book?: string; from?: string; to?: string }

const STATUS: Record<DownloadRecord["status"], [string, string]> = {
  completed: ["chip chip-ok", "Completada"],
  cancelled: ["chip chip-draft", "Cancelada"],
  failed: ["chip border-danger text-danger", "Fallida"],
  started: ["chip chip-busy", "En curso"],
  sent: ["chip chip-ok", "Enviada"],
};
const METHOD: Record<string, string> = { original: "PDF original", recorte: "Recorte del original", imagenes: "Desde las páginas" };
const pagesLabel = (d: LogRow) => (d.from_page === 1 && d.book_total === d.to_page ? `Todo (1–${d.to_page})` : d.book_labels ? rangeText(parseLabels(d.book_labels), d.from_page, d.to_page) : d.from_page === d.to_page ? String(d.from_page) : `${d.from_page}–${d.to_page}`);
const qs = (f: LogFilter, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const COLS = "md:grid md:grid-cols-[9.5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_8rem_5.5rem_6.5rem_6.5rem] md:items-center md:gap-3";

function Who({ d }: { d: LogRow }) {
  return d.actor === "admin" ? <span className="font-medium">Admin</span> : <span className="min-w-0"><span className="font-medium">{d.display_name}</span> <span className="text-muted">@{d.username}</span></span>;
}

/** The log as a table from md up and as cards on phones. */
export function LogTable({ rows, showUser = true, showBook = true }: { rows: LogRow[]; showUser?: boolean; showBook?: boolean }) {
  return (
    <div role="table" aria-label="Descargas" className="md:card md:overflow-hidden" data-testid="log-table">
      <div role="row" className={`hidden border-b border-line bg-surface/60 px-3 py-2.5 text-sm text-muted ${COLS}`}>
        <span role="columnheader">Fecha y hora</span><span role="columnheader">Usuario</span><span role="columnheader">Libro</span><span role="columnheader">Páginas</span><span role="columnheader" className="text-right">Nº de páginas</span><span role="columnheader">Dispositivo</span><span role="columnheader">Estado</span>
      </div>
      <ul role="rowgroup" className="space-y-3 md:space-y-0">
        {rows.map((d) => {
          const [chip, text] = STATUS[d.status];
          return (
            <li key={d.id} role="row" data-status={d.status} className={`card p-4 text-[15px] md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:bg-transparent md:p-3 md:shadow-none first:md:border-t-0 ${COLS}`}>
              <span role="cell" className="tnum text-muted md:text-fg">{fmtDateTime(d.created_at)}</span>
              <span role="cell" className={`min-w-0 [overflow-wrap:anywhere] ${showUser ? "" : "hidden"}`} data-col="user"><Who d={d} /></span>
              <span role="cell" className={`min-w-0 [overflow-wrap:anywhere] ${showBook ? "" : "hidden"}`} data-col="book">{d.book_title}</span>
              <span role="cell" className="tnum" data-col="pages"><span className="text-muted md:hidden">Páginas: </span>{pagesLabel(d)}</span>
              <span role="cell" className="tnum md:text-right" data-col="count"><span className="text-muted md:hidden">Nº de páginas: </span>{d.page_count}</span>
              <span role="cell" data-col="device"><span className="text-muted md:hidden">Dispositivo: </span>{d.device}</span>
              <span role="cell" className="mt-1 md:mt-0"><span className={`${chip} w-fit`}>{text}</span>{d.method && <span className="mt-1 block text-xs text-muted" data-col="method">{METHOD[d.method]}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Newest downloads for one user or one book (inside their detail). */
export function DownloadHistory({ filter }: { filter: LogFilter }) {
  const [data, setData] = useState<LogResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(filter);
  useEffect(() => {
    let dead = false;
    api<LogResponse>(`/api/admin/downloads${qs(JSON.parse(key) as LogFilter)}`).then((r) => { if (!dead) setData(r); }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [key]);
  if (failed) return <p role="alert" className="err">No se pudo cargar el historial.</p>;
  if (!data) return <div className="skeleton h-16 rounded-card" aria-label="Cargando" />;
  if (!data.available) return null;
  const mine = "user" in filter && filter.user;
  return (
    <div className="space-y-2" data-testid="download-history">
      <h4 className="text-sm font-medium">Descargas <span className="tnum font-normal text-muted">({data.total})</span></h4>
      {data.rows.length === 0 ? <p className="hint">Todavía no hay descargas.</p> : <LogTable rows={data.rows} showUser={!mine} showBook={!!mine} />}
      {data.pages > 1 && <p className="hint">Se muestran las {data.size} más recientes de {data.total}. El historial completo está en «Descargas».</p>}
    </div>
  );
}

const startOfDay = (v: string) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(); };
const endOfDay = (v: string) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(); };

/** Admin → Descargas: who downloaded what, newest first, with filters, pages of 50 and a CSV export. */
export default function DownloadsPanel() {
  const toast = useToast();
  const [user, setUser] = useState("");
  const [book, setBook] = useState("");
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogResponse | null>(null);
  const filter: LogFilter = { user, book, from: dFrom ? startOfDay(dFrom) : "", to: dTo ? endOfDay(dTo) : "" };
  const fkey = JSON.stringify(filter);

  useEffect(() => {
    let dead = false;
    api<LogResponse>(`/api/admin/downloads${qs(JSON.parse(fkey) as LogFilter, { page })}`)
      .then((r) => { if (!dead) setData(r); })
      .catch((e) => { if (!dead) toast("error", errText(e)); });
    return () => { dead = true; };
  }, [fkey, page, toast]);

  const change = (fn: () => void) => { fn(); setPage(1); };
  const f = data?.filters;
  return (
    <div className="space-y-5">
      <div className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl">Descargas</h2>
          <a className="btn" href={`/api/admin/downloads/export${qs(filter)}`} download><Icon name="download" size={18} />Exportar CSV</a>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="f-user" className="label">Usuario</label>
            <select id="f-user" className="field" value={user} onChange={(e) => change(() => setUser(e.target.value))}>
              <option value="">Todos</option>
              {f?.has_admin && <option value="admin">Admin</option>}
              {f?.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-book" className="label">Libro</label>
            <select id="f-book" className="field" value={book} onChange={(e) => change(() => setBook(e.target.value))}>
              <option value="">Todos</option>
              {f?.books.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className="label">Desde</label>
            <input id="f-from" type="date" className="field" value={dFrom} max={dTo || undefined} onChange={(e) => change(() => setDFrom(e.target.value))} />
          </div>
          <div>
            <label htmlFor="f-to" className="label">Hasta</label>
            <input id="f-to" type="date" className="field" value={dTo} min={dFrom || undefined} onChange={(e) => change(() => setDTo(e.target.value))} />
          </div>
        </div>
        <p className="tnum text-[15px]" aria-live="polite" data-testid="log-total">{data ? `${data.total.toLocaleString("es-ES")} ${data.total === 1 ? "descarga" : "descargas"}` : "Cargando…"}</p>
      </div>

      {data === null ? (
        <div className="space-y-3" aria-label="Cargando"><div className="skeleton h-24 rounded-card" /><div className="skeleton h-24 rounded-card" /></div>
      ) : data.rows.length === 0 ? (
        <div className="card px-6 py-12 text-center"><h3 className="text-3xl">No hay descargas</h3><p className="mt-2 text-muted">{data.total === 0 && !user && !book && !dFrom && !dTo ? "Aquí aparecerá quién descarga qué, y cuándo." : "Ninguna descarga coincide con los filtros."}</p></div>
      ) : (
        <>
          <LogTable rows={data.rows} />
          <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3">
            <button className="btn" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Anterior</button>
            <span className="tnum text-[15px] text-muted" data-testid="log-page">Página {data.page} de {data.pages}</span>
            <button className="btn" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Siguiente</button>
          </nav>
        </>
      )}
    </div>
  );
}
