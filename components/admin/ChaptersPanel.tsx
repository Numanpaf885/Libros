"use client";
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { readPdfChaptersUrl, readPdfMeta } from "@/lib/client/render-pdf";
import { chapterRanges, parseChapters, type Chapter } from "@/lib/chapters";
import { hasLabels, labelOf, pageFromInput, parseLabels } from "@/lib/page-labels";
import type { AdminBook } from "@/lib/types";

interface Row { key: number; t: string; page: string }
let nextKey = 1;

/**
 * "Capítulos": the book divided into chapters (a title and the page where each starts). Readers get a chapter list and
 * can download a chapter. Filled in from the PDF's bookmarks when the book is uploaded; editable here.
 */
export default function ChaptersPanel({ book, ready, onSaved }: { book: AdminBook; ready: boolean; onSaved: () => void }) {
  const toast = useToast();
  const labels = useMemo(() => parseLabels(book.page_labels, book.page_count), [book.page_labels, book.page_count]);
  const printed = hasLabels(labels);
  const shown = (p: number) => (printed ? labelOf(labels, p) || String(p) : String(p));
  const fromSaved = (c: readonly Chapter[]): Row[] => c.map((x) => ({ key: nextKey++, t: x.t, page: shown(x.p) }));
  const [rows, setRows] = useState<Row[]>(() => fromSaved(parseChapters(book.chapters, book.page_count)));
  const [busy, setBusy] = useState<"save" | "read" | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  if (!ready) return <p className="hint max-w-2xl" data-testid="chapters-panel">Para los capítulos falta actualizar la base de datos: ve a <strong className="text-fg">Mantenimiento</strong> y pulsa «Actualizar base de datos».</p>;

  // what each row means: its file page (a printed number, a roman numeral or a label is converted)
  const fileOf = (v: string): number | null => {
    const s = v.trim();
    if (!s) return null;
    if (printed) return pageFromInput(labels, book.page_count, s);
    const n = Number(s);
    return /^\d{1,5}$/.test(s) && n >= 1 && n <= book.page_count ? n : null;
  };
  const pages = rows.map((r) => fileOf(r.page));
  const problems = rows.map((r, i) => {
    if (!r.t.trim()) return "Escribe el título.";
    if (pages[i] === null) return printed ? "No encuentro esa página." : `Página entre 1 y ${book.page_count}.`;
    if (pages.indexOf(pages[i]) !== i) return "Otro capítulo empieza en esta página.";
    return "";
  });
  const valid = problems.every((p) => !p);
  const list: Chapter[] = valid ? rows.map((r, i) => ({ t: r.t.trim(), p: pages[i]! })).sort((a, b) => a.p - b.p) : [];
  const ranges = chapterRanges(list, book.page_count);
  const rangeOf = (i: number) => {
    const r = pages[i] === null ? null : ranges.find((x) => x.from === pages[i]);
    if (!r) return "";
    const a = shown(r.from), b = shown(r.to);
    return r.from === r.to ? `pág. ${a}` : `págs. ${a}–${b}`;
  };

  const set = (k: number, patch: Partial<Row>) => { setErr(""); setNote(""); setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r))); };
  const add = () => {
    const last = pages.filter((p): p is number => p !== null).reduce((m, p) => Math.max(m, p), 0);
    setRows((rs) => [...rs, { key: nextKey++, t: "", page: shown(Math.min(book.page_count, last + 1)) }]);
  };

  async function save(chapters: Chapter[], done: string) {
    setBusy("save"); setErr("");
    try {
      await api(`/api/admin/books/${book.id}/chapters`, "PUT", { chapters });
      toast("ok", done);
      setNote("");
      onSaved();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(null);
  }
  async function read(from: "original" | File) {
    setBusy("read"); setErr(""); setNote("");
    try {
      const r = from === "original"
        ? await readPdfChaptersUrl(book.original_pdf_size, async () => (await api<{ url: string }>(`/api/admin/books/${book.id}/text`, "POST", { action: "original" })).url)
        : await readPdfMeta(from);
      if (r.pageCount !== book.page_count) setErr(`Este PDF tiene ${r.pageCount} páginas y el libro tiene ${book.page_count}. Tiene que ser el mismo PDF.`);
      else if (r.chapters.length < 2) setErr("Este PDF no trae marcadores con los capítulos. Añádelos a mano.");
      else { setRows(fromSaved(r.chapters)); setNote(`${r.chapters.length} capítulos leídos de los marcadores del PDF. Revísalos y pulsa «Guardar».`); }
    } catch {
      setErr("No se ha podido leer el PDF.");
    }
    setBusy(null);
  }

  return (
    <div className="max-w-3xl space-y-4" data-testid="chapters-panel">
      <div className="space-y-1">
        <h3 className="text-xl">Capítulos</h3>
        <p className="hint">Cada capítulo empieza en su página y llega hasta la anterior al siguiente. Los lectores ven la lista de capítulos y pueden descargar uno.{printed ? " Escribe la página impresa (45), un número romano (iii) o una etiqueta." : ""}</p>
      </div>

      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) void save(list, list.length ? "Capítulos guardados" : "Capítulos quitados"); }}>
        {rows.length === 0 && <p className="text-[15px] text-muted" data-testid="chapters-empty">Este libro no tiene capítulos.</p>}
        <ol className="space-y-2" data-testid="chapters-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_auto]">
              <div>
                <label className="sr-only" htmlFor={`ch-t-${r.key}`}>Título del capítulo {i + 1}</label>
                <input id={`ch-t-${r.key}`} className="field min-h-11 w-full" value={r.t} maxLength={200} placeholder="Título" onChange={(e) => set(r.key, { t: e.target.value })} aria-invalid={!!problems[i]} data-testid="chapter-title" />
                {problems[i] && <p className="err mt-1 text-[13px]" data-testid="chapter-problem">{problems[i]}</p>}
              </div>
              <div>
                <label className="sr-only" htmlFor={`ch-p-${r.key}`}>Página donde empieza el capítulo {i + 1}</label>
                <input id={`ch-p-${r.key}`} className="field tnum min-h-11 w-full text-center" inputMode={printed ? "text" : "numeric"} autoComplete="off" value={r.page} placeholder="Pág." onChange={(e) => set(r.key, { page: e.target.value.slice(0, 16) })} data-testid="chapter-page" />
              </div>
              <span className="tnum hidden min-h-11 items-center text-sm text-muted sm:flex" data-testid="chapter-range">{rangeOf(i)}</span>
              <button type="button" className="btn btn-icon min-h-11! min-w-11!" aria-label={`Quitar el capítulo ${i + 1}`} title="Quitar" onClick={() => { setErr(""); setRows((rs) => rs.filter((x) => x.key !== r.key)); }}><Icon name="close" size={18} /></button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={add} disabled={rows.length >= 500}><Icon name="plus" size={16} />Añadir capítulo</button>
        </div>
        {note && <p className="hint" role="status" data-testid="chapters-note">{note}</p>}
        {err && <p role="alert" className="err" data-testid="chapters-error">{err}</p>}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !valid} aria-busy={busy === "save"}>Guardar</button>
          {book.chapters && <button type="button" className="btn" disabled={busy !== null} onClick={() => void save([], "Capítulos quitados")}>Quitar todos los capítulos</button>}
        </div>
      </form>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="font-medium">Leer los capítulos de los marcadores del PDF</p>
        {book.original_pdf_size > 0 && (
          <button type="button" className="btn btn-sm" disabled={busy !== null} aria-busy={busy === "read"} onClick={() => void read("original")}>Leer del PDF original guardado</button>
        )}
        <div>
          <label htmlFor={`ch-pdf-${book.id}`} className="label">{book.original_pdf_size > 0 ? "O selecciona el PDF en tu ordenador" : "Selecciona el PDF del libro"}</label>
          <input
            id={`ch-pdf-${book.id}`} type="file" accept="application/pdf" disabled={busy !== null} data-testid="chapters-pdf"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-ctl file:border file:border-line-strong file:bg-surface file:px-4 file:py-2 file:text-fg"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }}
          />
          <p className="hint mt-1">Se lee desde tu disco y no se sube. Lo leído sustituye a la lista de arriba hasta que pulses «Guardar».</p>
        </div>
      </div>
    </div>
  );
}
