"use client";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { readPdfMeta } from "@/lib/client/render-pdf";
import { labelOf, parseLabels, rangesFromOffset, rangesFromPageLabels, stringifyLabels, type LabelRange } from "@/lib/page-labels";
import type { AdminBook } from "@/lib/types";

const PREVIEW = 30;

/** Where the form starts from: the saved numbering, read back as "page 1 is on file page N". */
function initial(raw: string) {
  const r = parseLabels(raw);
  const firstDecimal = r.find((x) => x.style === "D" && !x.prefix && (x.first ?? 1) === 1);
  const n = firstDecimal?.start ?? 1;
  const before: "roman" | "none" = r.some((x) => x.start < n && (x.style === "r" || x.style === "R")) ? "roman" : r.some((x) => x.start < n && x.style === "none" && !x.prefix) ? "none" : "roman";
  const cover = r[0]?.style === "none" && r[0].prefix && r[0].start === 1 && n > 1 ? r[0].prefix : "";
  return { n, before, cover };
}

/** "Numeración de páginas": printed numbers (front matter, roman numerals, an offset) shown in the reader. Storage keeps file pages. */
export default function PageNumbering({ book, onSaved }: { book: AdminBook; onSaved: () => void }) {
  const toast = useToast();
  const start = useMemo(() => initial(book.page_labels), [book.page_labels]);
  const [n, setN] = useState(String(start.n));
  const [before, setBefore] = useState<"roman" | "none">(start.before);
  const [coverOn, setCoverOn] = useState(!!start.cover);
  const [detected, setDetected] = useState<LabelRange[] | null>(null); // from "Detectar desde el PDF"; edited fields replace it
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const nNum = Math.floor(Number(n));
  const nOk = /^\d{1,4}$/.test(n.trim()) && nNum >= 1 && nNum <= book.page_count;
  const ranges: LabelRange[] = detected ?? (nOk ? rangesFromOffset({ firstFilePage: nNum, before, coverLabel: coverOn ? "Portada" : "" }) : []);
  const preview = Array.from({ length: Math.min(PREVIEW, book.page_count) }, (_, i) => ({ file: i + 1, label: ranges.length ? labelOf(ranges, i + 1) : String(i + 1) }));
  const edit = <T,>(set: (v: T) => void) => (v: T) => { setDetected(null); setErr(""); set(v); };

  async function save(raw: string, done: string) {
    setBusy(true); setErr("");
    try {
      await api(`/api/admin/books/${book.id}/labels`, "PUT", { page_labels: raw });
      toast("ok", done);
      onSaved();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  async function detect(file: File) {
    setErr("");
    try {
      const meta = await readPdfMeta(file);
      if (meta.pageCount !== book.page_count) { setErr(`Este PDF tiene ${meta.pageCount} páginas y el libro tiene ${book.page_count}.`); return; }
      const r = rangesFromPageLabels(meta.labels);
      if (!r.length) { setErr("Este PDF no trae numeración propia: las páginas llevan el número del archivo."); return; }
      setDetected(r);
    } catch {
      setErr("No se ha podido leer el PDF.");
    }
  }

  return (
    <div className="max-w-2xl space-y-4" data-testid="numbering-panel">
      <div>
        <h3 className="text-xl">Numeración de páginas</h3>
        <p className="hint mt-1">Para que el lector muestre los números impresos en el libro (portada, números romanos, desfase) en lugar del número del archivo.</p>
      </div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (detected || nOk) void save(stringifyLabels(ranges), "Numeración guardada"); }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px]">
          <label htmlFor={`off-${book.id}`}>La página 1 del libro está en la página</label>
          <input id={`off-${book.id}`} inputMode="numeric" autoComplete="off" value={n} onChange={(e) => edit(setN)(e.target.value.replace(/\D/g, "").slice(0, 4))} className="field tnum min-h-11 w-20! text-center" aria-invalid={!nOk} />
          <span>del archivo</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px]">
          <label htmlFor={`bef-${book.id}`}>Páginas anteriores</label>
          <select id={`bef-${book.id}`} value={before} onChange={(e) => edit(setBefore)(e.target.value as "roman" | "none")} className="field min-h-11 w-auto!" disabled={nNum <= 1}>
            <option value="roman">Números romanos</option>
            <option value="none">Sin número</option>
          </select>
          <label htmlFor={`cov-${book.id}`}>Primera página</label>
          <select id={`cov-${book.id}`} value={coverOn ? "cover" : "none"} onChange={(e) => edit(setCoverOn)(e.target.value === "cover")} className="field min-h-11 w-auto!" disabled={nNum <= 1}>
            <option value="cover">Portada</option>
            <option value="none">Sin etiqueta</option>
          </select>
        </div>
        {detected && <p className="hint" role="status">Numeración leída del PDF. Revisa la vista previa y pulsa Guardar.</p>}
        {!nOk && !detected && <p role="alert" className="err">Escribe un número de página del archivo entre 1 y {book.page_count}.</p>}

        <div aria-label="Vista previa de la numeración" className="rounded-card border border-line bg-surface/50 p-3">
          <p className="mb-2 text-sm text-muted">Vista previa (primeras {preview.length} páginas del archivo)</p>
          <ul className="flex flex-wrap gap-1.5" data-testid="numbering-preview">
            {preview.map((p) => (
              <li key={p.file} className="tnum rounded-ctl border border-line bg-bg px-2 py-1 text-[13px]" data-file={p.file}>
                <span className="text-muted">{p.file}</span> → <span className="font-medium">{p.label || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        {err && <p role="alert" className="err">{err}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={busy || (!nOk && !detected)} aria-busy={busy}>Guardar</button>
          <button type="button" className="btn btn-sm" disabled={busy || !book.page_labels} onClick={() => void save("", "Numeración restablecida")}>Restablecer (sin numeración)</button>
          <label className={`btn btn-sm ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            Detectar desde el PDF
            <input type="file" accept="application/pdf" className="sr-only" data-testid="numbering-detect" onChange={(e) => { const f = e.target.files?.[0]; if (f) void detect(f); e.target.value = ""; }} />
          </label>
        </div>
      </form>
    </div>
  );
}
