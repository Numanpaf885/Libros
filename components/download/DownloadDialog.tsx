"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, AuthError, errText } from "@/lib/client/api";
import { cropPdf, fetchWithProgress } from "@/lib/client/pdf-crop";
import { buildPdf, saveBlob, saveUrl } from "@/lib/client/pdf-download";
import { chooseMethod, deviceOfUa, formatBytes } from "@/lib/download-method";
import { hasLabels, labelOf, labelTotal, pageFromInput, type LabelRange } from "@/lib/page-labels";
import type { DownloadMethod } from "@/lib/types";

export const MAX_USER_PAGES = 1000;
type Result = null | "completed" | "cancelled" | "failed" | "sent";
const NO_LABELS: LabelRange[] = [];
interface Info { original_pdf_size: number; avg_page_bytes: number }
interface Props {
  open: boolean;
  onClose: () => void;
  bookTitle: string;
  slug: string;
  pageCount: number;
  /** admin: any book, logged as "Admin". user: the reader's own permission, a server token and the hourly limit. */
  mode: "admin" | "user";
  bookId?: string;
  /** user mode: the page or spread on screen, for the "Página actual" button */
  current?: [number, number];
  /** printed page numbers: the range is typed in them, and the file pages are shown next to it */
  labels?: LabelRange[];
}

/** Tells the server how the download ended: one write. `beacon` is for a closing tab, where fetch may be cut off. */
function finish(id: string | null, status: "completed" | "cancelled" | "failed", beacon = false) {
  if (!id) return;
  const url = `/api/downloads/${id}/finish`;
  const body = JSON.stringify({ status });
  if (beacon && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export default function DownloadDialog({ open, onClose, bookTitle, slug, pageCount, mode, bookId, current, labels = NO_LABELS }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [scope, setScope] = useState<"all" | "range">("all");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(String(pageCount));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; bytes?: boolean; note?: string } | null>(null);
  const [info, setInfo] = useState<Info | null>(null); // original PDF size and average page image, to pick the method
  const printed = hasLabels(labels);
  const shownFirst = printed ? labelOf(labels, 1) || "1" : "1";
  const shownLast = printed ? String(labelTotal(labels, pageCount)) : String(pageCount);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const active = useRef<string | null>(null); // id of the log row while a download runs

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setScope("all"); setFrom(shownFirst); setTo(shownLast); setProgress(null); setResult(null); setError(""); setFile("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, pageCount, shownFirst, shownLast]);

  // What the fastest way to build this download depends on: is there an original PDF, and how big are the pages.
  useEffect(() => {
    if (!open) return;
    let dead = false;
    api<Info>(mode === "admin" ? `/api/admin/books/${bookId}/download-info` : `/api/books/${encodeURIComponent(slug)}/download/info`)
      .then((r) => { if (!dead) setInfo(r); })
      .catch(() => { if (!dead) setInfo({ original_pdf_size: 0, avg_page_bytes: 0 }); });
    return () => { dead = true; setInfo(null); };
  }, [open, mode, bookId, slug]);

  // A tab that closes in the middle of a download marks it as cancelled.
  useEffect(() => {
    if (!running) return;
    const bye = () => { if (active.current) { finish(active.current, "cancelled", true); active.current = null; } };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [running]);

  // `a`..`b` are FILE pages. With printed numbers, what is typed is converted (a number, a roman numeral or a label).
  const asFile = (v: string): number => (printed ? (pageFromInput(labels, pageCount, v) ?? NaN) : Number(v));
  const a = scope === "all" ? 1 : asFile(from);
  const b = scope === "all" ? pageCount : asFile(to);
  const intOk = (v: string) => /^\d{1,5}$/.test(v.trim());
  let problem = "";
  if (scope === "range" && printed && (Number.isNaN(a) || Number.isNaN(b))) problem = "No encuentro esas páginas. Escribe el número impreso (45), un número romano (iii) o una etiqueta.";
  else if (scope === "range" && !printed && (!intOk(from) || !intOk(to))) problem = "Escribe números de página.";
  else if (a < 1 || b > pageCount) problem = `Las páginas van de 1 a ${pageCount}.`;
  else if (a > b) problem = "La página inicial no puede ser mayor que la final.";
  else if (mode === "user" && b - a + 1 > MAX_USER_PAGES) problem = `Puedes descargar como máximo ${MAX_USER_PAGES.toLocaleString("es-ES")} páginas cada vez.`;
  const valid = !problem;
  const choice = valid && info ? chooseMethod({ from: a, to: b, pageCount, originalSize: info.original_pdf_size, avgPageBytes: info.avg_page_bytes, device: deviceOfUa(typeof navigator === "undefined" ? "" : navigator.userAgent) }) : null;
  const method: DownloadMethod = choice?.method ?? "imagenes";

  async function start() {
    if (problem || running) return;
    setError(""); setResult(null); setProgress({ done: 0, total: b - a + 1 }); setRunning(true);
    const name = method === "original" ? `${slug}.pdf` : `${slug}-p${a}-${b}.pdf`;
    const c = new AbortController();
    ctl.current = c;
    let id: string | null = null;
    try {
      let urls: (pages: number[]) => Promise<{ page: number; url: string }[]>;
      let originalUrl: () => Promise<{ url: string; size: number }>;
      if (mode === "admin") {
        id = (await api<{ id: string | null }>("/api/admin/downloads", "POST", { book_id: bookId, from: a, to: b, method })).id;
        urls = async (pages) => (await api<{ urls: { page: number; url: string }[] }>(`/api/admin/books/${bookId}/page-urls`, "POST", { pages })).urls;
        originalUrl = () => api(`/api/admin/books/${bookId}/original-url`, "POST", { download_id: id });
      } else {
        const r = await api<{ id: string; token: string }>(`/api/books/${encodeURIComponent(slug)}/download`, "POST", { from: a, to: b, method });
        id = r.id;
        urls = async (pages) => (await api<{ urls: { page: number; url: string }[] }>(`/api/books/${encodeURIComponent(slug)}/download/pages`, "POST", { token: r.token, pages })).urls;
        originalUrl = () => api(`/api/books/${encodeURIComponent(slug)}/download/original`, "POST", { token: r.token });
      }
      if (method === "original") {
        // The whole book: the browser downloads the stored PDF itself. The server logs it as "sent" when it hands out the URL.
        const o = await originalUrl();
        saveUrl(o.url, name);
        setFile(name);
        setResult("sent");
      } else {
        active.current = id;
        let pdf: Blob;
        if (method === "recorte") {
          const o = await originalUrl();
          setProgress({ done: 0, total: o.size, bytes: true });
          const bytes = await fetchWithProgress(o.url, o.size, c.signal, (done, total) => setProgress({ done, total, bytes: true }));
          setProgress({ done: 1, total: 1, note: "Recortando las páginas…" });
          pdf = await cropPdf(bytes, a, b);
        } else {
          pdf = await buildPdf({ from: a, to: b, urls, signal: c.signal, onProgress: (done, total) => setProgress({ done, total }) });
        }
        saveBlob(pdf, name);
        active.current = null;
        finish(id, "completed");
        setFile(name);
        setResult("completed");
      }
    } catch (e) {
      const cancelled = c.signal.aborted;
      if (id && active.current) { finish(id, cancelled ? "cancelled" : "failed"); active.current = null; }
      if (cancelled) setResult("cancelled");
      else {
        setResult("failed");
        setError(e instanceof ApiError || e instanceof AuthError ? e.message : errText(e) === "Algo ha salido mal. Inténtalo de nuevo." ? "No se ha podido preparar el PDF. Inténtalo de nuevo." : errText(e));
      }
    }
    setRunning(false);
  }
  const cancel = () => ctl.current?.abort();
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const methodText = !valid ? "" : !info ? "Calculando el mejor método…"
    : method === "original" ? `PDF original · ${formatBytes(choice!.estimate)}`
    : method === "recorte" ? `Recorte del PDF original · se descargan ${formatBytes(choice!.estimate)}`
    : `Se generará a partir de las páginas${choice!.estimate > 0 ? ` · ~${formatBytes(choice!.estimate)}` : ""}`;

  return (
    <dialog
      ref={ref} aria-labelledby={`${uid}-title`}
      onCancel={(e) => { e.preventDefault(); if (!running) onClose(); }}
      onClick={(e) => { if (e.target === ref.current && !running) onClose(); }}
      className="m-auto w-[min(92vw,32rem)] rounded-card border border-line-strong bg-bg p-0 text-fg shadow-sm backdrop:bg-black/50"
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); void start(); }} className="space-y-4 p-5 sm:p-6">
        <div>
          <h2 id={`${uid}-title`} className="text-2xl">Descargar PDF</h2>
          <p className="mt-1 truncate text-[15px] text-muted">{bookTitle}</p>
        </div>

        <fieldset className="space-y-1" disabled={running}>
          <legend className="sr-only">Páginas</legend>
          <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`${uid}-scope`} checked={scope === "all"} onChange={() => setScope("all")} />Todo el libro <span className="tnum text-muted">({pageCount} páginas)</span></label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`${uid}-scope`} checked={scope === "range"} onChange={() => setScope("range")} />Páginas</label>
            <label htmlFor={`${uid}-from`} className="sr-only">Desde la página</label>
            <input id={`${uid}-from`} inputMode="numeric" autoComplete="off" value={from} onFocus={() => setScope("range")} onChange={(e) => setFrom(printed ? e.target.value.replace(/[^\p{L}\p{N} .\-]/gu, "").slice(0, 16) : e.target.value.replace(/\D/g, "").slice(0, 5))} className={`field tnum min-h-11 text-center ${printed ? "w-28!" : "w-20!"}`} />
            <span className="text-[15px] text-muted">a</span>
            <label htmlFor={`${uid}-to`} className="sr-only">Hasta la página</label>
            <input id={`${uid}-to`} inputMode="numeric" autoComplete="off" value={to} onFocus={() => setScope("range")} onChange={(e) => setTo(printed ? e.target.value.replace(/[^\p{L}\p{N} .\-]/gu, "").slice(0, 16) : e.target.value.replace(/\D/g, "").slice(0, 5))} className={`field tnum min-h-11 text-center ${printed ? "w-28!" : "w-20!"}`} />
            {current && <button type="button" className="btn btn-sm" disabled={running} onClick={() => { setScope("range"); setFrom(printed ? labelOf(labels, current[0]) || String(current[0]) : String(current[0])); setTo(printed ? labelOf(labels, current[1]) || String(current[1]) : String(current[1])); }}>Página actual</button>}
          </div>
        </fieldset>

        {problem && scope === "range" && <p role="alert" className="err" data-testid="dl-problem">{problem}</p>}
        {problem && scope === "all" && <p role="alert" className="err" data-testid="dl-problem">{mode === "user" ? `Este libro tiene más de ${MAX_USER_PAGES.toLocaleString("es-ES")} páginas: elige un rango más corto.` : problem}</p>}
        {printed && valid && <p className="tnum text-[15px]" data-testid="dl-file-range">{scope === "all" ? `Todo el libro (archivo 1–${pageCount})` : `Páginas ${from.trim()} a ${to.trim()} (archivo ${a}–${b})`}</p>}
        {methodText && <p className="text-[15px] font-medium" data-testid="dl-method" data-method={info ? method : ""}>{methodText}</p>}
        <p className="hint">{method === "original" ? "Se descarga el PDF original tal cual" : method === "recorte" ? "Se descarga el PDF original y las páginas que pides se recortan en tu dispositivo" : "El PDF se prepara en tu dispositivo, página a página"}{mode === "user" ? `; puedes hacer hasta 5 descargas por hora` : ""}.</p>

        {(running || progress) && (
          <div className="space-y-2" role="status">
            <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label="Progreso de la descarga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
            </div>
            <p className="tnum text-sm text-muted" data-testid="dl-progress">{progress ? (progress.note ?? (progress.bytes ? `Descargando el original: ${formatBytes(progress.done)} / ${formatBytes(progress.total)} · ${pct} %` : `${progress.done} / ${progress.total} páginas · ${pct} %`)) : ""}</p>
          </div>
        )}
        {result === "completed" && <p role="status" className="text-[15px] text-ok" data-testid="dl-done">Descarga lista: {file}</p>}
        {result === "sent" && <p role="status" className="text-[15px] text-ok" data-testid="dl-sent">Descarga iniciada: {file}</p>}
        {result === "cancelled" && <p role="status" className="text-[15px] text-muted" data-testid="dl-cancelled">Descarga cancelada.</p>}
        {result === "failed" && <p role="alert" className="err" data-testid="dl-failed">{error || "No se ha podido preparar el PDF. Inténtalo de nuevo."}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {running ? (
            <button type="button" className="btn" onClick={cancel}>Cancelar</button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>{result === "completed" || result === "sent" ? "Cerrar" : "Cancelar"}</button>
          )}
          <button aria-busy={running} type="submit" disabled={running || !!problem} className="btn btn-primary"><span>Descargar PDF</span></button>
        </div>
      </form>
    </dialog>
  );
}
