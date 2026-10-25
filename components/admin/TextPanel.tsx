"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toaster";
import { api, ApiError, AuthError, errText } from "@/lib/client/api";
import { runOcr } from "@/lib/client/ocr";
import { openPdf, openPdfUrl } from "@/lib/client/render-pdf";
import { extractedBeforeRotation, extractText, PageCountError, textState, type TextState } from "@/lib/client/text-store";
import { formatEta } from "@/lib/client/upload";
import type { AdminBook } from "@/lib/types";

const STATUS: Record<TextState["text_status"], [string, string]> = {
  none: ["chip chip-draft", "Sin texto"],
  partial: ["chip chip-busy", "Parcial"],
  full: ["chip chip-ok", "Completo"],
};
interface Prog { done: number; total: number; etaSec?: number | null }

function Bar({ p, label, testid }: { p: Prog | null; label: string; testid: string }) {
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="space-y-2" role="status" data-testid={testid}>
      <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum text-sm text-muted">{p ? `${label}: ${p.done} / ${p.total} páginas · ${pct} %${p.etaSec !== undefined ? ` · ${formatEta(p.etaSec)}` : ""}` : `${label}…`}</p>
    </div>
  );
}

/** "Texto": the selectable text of a book (status, "Extraer texto", OCR of the pages without text, and the switch). */
export default function TextPanel({ book }: { book: AdminBook }) {
  const toast = useToast();
  const [st, setSt] = useState<TextState | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState<"extract" | "ocr" | "switch" | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState<null | (() => void)>(null);
  /** the PDF text was extracted before rotated text and margins were handled: re-extracting improves the selection */
  const [old, setOld] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Only the latest load is shown, and if the switch changed while it was on its way, the switch keeps what is on
  // screen (that answer is older). Two loads overlap when the panel mounts twice (development) or reloads after a task.
  const loads = useRef(0);
  const edits = useRef(0);

  const load = useCallback(() => {
    const mine = ++loads.current, at = edits.current;
    return textState(book.id).then((s) => {
      if (mine !== loads.current) return;
      setSt((cur) => (at === edits.current || !cur ? s : { ...s, allow_copy: cur.allow_copy }));
      setLoadErr("");
      return extractedBeforeRotation(book.id, s).then((o) => { if (mine === loads.current) setOld(o); });
    }).catch((e) => { if (mine === loads.current) setLoadErr(errText(e)); });
  }, [book.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => ctl.current?.abort(), []); // leaving the panel pauses a running OCR (it continues from there)

  if (loadErr) return <ErrorState title="No se ha podido cargar el estado del texto" text={loadErr} onRetry={() => { setLoadErr(""); void load(); }} />;
  if (!st) return <div className="skeleton h-40 max-w-2xl rounded-card" aria-label="Cargando" />;
  if (!st.ready) return <p className="hint max-w-2xl">Para el texto seleccionable falta actualizar la base de datos: ve a <strong className="text-fg">Mantenimiento</strong> y pulsa «Actualizar base de datos».</p>;

  const processed = st.pages.replace(/-/g, "").length > 0;
  const hasOcr = st.pages.includes("o") || st.pages.includes("b");
  const todo = [...st.pages].flatMap((c, i) => (c === "s" || c === "-" ? [i + 1] : [])); // pages without text, never recognised
  const [chip, chipText] = STATUS[st.text_status];

  async function extract(from: "original" | File) {
    setErr(""); setProg(null); setBusy("extract");
    const c = new AbortController();
    ctl.current = c;
    try {
      const open = from === "original"
        ? () => openPdfUrl(st!.original_size, async () => (await api<{ url: string }>(`/api/admin/books/${book.id}/text`, "POST", { action: "original" })).url)
        : () => openPdf(from);
      const r = await extractText({ bookId: book.id, pageCount: st!.page_count, open, onProgress: (done, total) => setProg({ done, total }), signal: c.signal });
      toast("ok", r.text_pages ? `Texto extraído: ${r.text_pages} de ${st!.page_count} páginas` : "Este PDF no tiene texto: usa el reconocimiento (OCR)");
    } catch (e) {
      setErr(c.signal.aborted ? "Extracción cancelada. Vuelve a extraer cuando quieras."
        : e instanceof PageCountError ? `Este PDF tiene ${e.pdfPages} páginas y el libro tiene ${e.bookPages}. Tiene que ser el mismo PDF.`
        : from === "original" && !(e instanceof ApiError || e instanceof AuthError) ? "No se ha podido leer el PDF original guardado. Selecciona el PDF en tu ordenador."
        : errText(e));
    } finally {
      setBusy(null); setProg(null);
      if (input.current) input.current.value = "";
      await load();
    }
  }
  /** Re-extracting deletes what OCR recognised too: ask first. */
  const confirmThen = (fn: () => void) => (hasOcr ? setAsk(() => fn) : fn());

  async function ocr() {
    setErr(""); setPaused(false); setProg({ done: 0, total: todo.length, etaSec: null }); setBusy("ocr");
    const c = new AbortController();
    ctl.current = c;
    try {
      await runOcr({ bookId: book.id, pageCount: st!.page_count, pages: todo, onProgress: setProg, signal: c.signal });
      toast("ok", "Reconocimiento terminado");
    } catch (e) {
      if (!c.signal.aborted) setErr(e instanceof ApiError || e instanceof AuthError ? e.message : "El reconocimiento se ha detenido. Pulsa «Reanudar» para seguir donde se quedó.");
      setPaused(true); // what was recognised is kept: the button continues from there
    } finally {
      setBusy(null); setProg(null);
      await load();
    }
  }

  async function setAllow(on: boolean) {
    edits.current++;
    setBusy("switch");
    setSt((s) => (s ? { ...s, allow_copy: on } : s)); // the switch moves at once; it goes back if saving fails
    try {
      await api(`/api/admin/books/${book.id}/text`, "POST", { action: "settings", allow_copy: on });
      toast("ok", on ? "Los lectores pueden seleccionar y copiar el texto" : "Los lectores ya no pueden seleccionar ni copiar el texto");
    } catch (e) {
      setSt((s) => (s ? { ...s, allow_copy: !on } : s));
      toast("error", errText(e));
    }
    setBusy(null);
  }

  return (
    <div className="max-w-2xl space-y-5" data-testid="text-panel">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="font-sans text-base font-semibold">Texto seleccionable</h4>
          <span className={`${chip} w-fit`} data-testid="text-status">{chipText}</span>
          <span className="tnum text-sm text-muted">{st.text_pages} de {st.page_count} páginas con texto</span>
        </div>
        <p className="hint">Los lectores pueden seleccionar y copiar el texto de las páginas; las páginas no cambian.</p>
      </div>

      <label className="flex min-h-11 w-fit items-center gap-3 text-[15px]">
        <input type="checkbox" role="switch" className="h-5 w-5" checked={st.allow_copy} disabled={busy !== null} onChange={(e) => void setAllow(e.target.checked)} data-testid="allow-copy" />
        Permitir seleccionar y copiar texto
      </label>

      <div className="space-y-3 border-t border-line pt-4">
        {old && busy !== "extract" && <p className="hint" role="note" data-testid="text-old">Vuelve a extraer el texto para mejorar la selección.</p>}
        {st.has_original && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" aria-busy={busy === "extract"} disabled={busy !== null} onClick={() => confirmThen(() => void extract("original"))}>{processed ? "Volver a extraer" : "Extraer texto"}</button>
            <span className="hint">Del PDF original guardado.</span>
          </div>
        )}
        <div>
          <label htmlFor={`text-pdf-${book.id}`} className="label">
            {st.has_original ? "O selecciona el PDF en tu ordenador" : processed ? "Volver a extraer: selecciona el PDF del libro" : "Extraer texto: selecciona el PDF del libro"}
          </label>
          <input
            ref={input} id={`text-pdf-${book.id}`} type="file" accept="application/pdf" disabled={busy !== null}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-ctl file:border file:border-line-strong file:bg-surface file:px-4 file:py-2 file:text-fg"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) confirmThen(() => void extract(f)); }}
          />
          <p className="hint mt-1">Tiene que ser el mismo PDF del libro, con {st.page_count} páginas. Se lee desde tu disco y no se sube.</p>
        </div>
        {busy === "extract" && (
          <div className="space-y-2">
            <Bar p={prog} label="Extrayendo texto" testid="text-progress" />
            <button type="button" className="btn btn-sm" onClick={() => ctl.current?.abort()}>Cancelar</button>
          </div>
        )}
      </div>

      {(todo.length > 0 || busy === "ocr") && (
        <div className="panel space-y-3 p-4" data-testid="ocr-box">
          <p className="font-medium" data-testid="ocr-count">
            {todo.length === 1 ? "1 página sin texto" : `${todo.length} páginas sin texto`}{st.scanned > 0 ? " (escaneadas)" : ""}
          </p>
          <p className="hint">Reconoce el texto de las imágenes de las páginas, en tu navegador y página a página. Puedes pausarlo y seguir más tarde: lo reconocido se guarda al momento.</p>
          {busy === "ocr" ? (
            <>
              <Bar p={prog} label="Reconociendo texto" testid="ocr-progress" />
              <button type="button" className="btn btn-sm" onClick={() => ctl.current?.abort()}>Pausar</button>
            </>
          ) : (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void ocr()}>{paused ? "Reanudar" : "Reconocer texto (OCR)"}</button>
          )}
        </div>
      )}
      {err && busy === null && <p role="alert" className="err">{err}</p>}

      <ConfirmDialog open={ask !== null} title="Volver a extraer el texto" confirmLabel="Volver a extraer" onCancel={() => setAsk(null)} onConfirm={() => { const fn = ask; setAsk(null); fn?.(); }}>
        <p>Se borrará el texto actual del libro, también el reconocido con OCR, y se leerá de nuevo del PDF.</p>
      </ConfirmDialog>
    </div>
  );
}
