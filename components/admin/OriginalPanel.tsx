"use client";
import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { fmtSize } from "@/lib/client/format";
import { abortOriginal, hasPendingOriginal, uploadOriginal, type OriginalProgress } from "@/lib/client/multipart";
import { readPdfMeta } from "@/lib/client/render-pdf";
import { rangesFromPageLabels, stringifyLabels } from "@/lib/page-labels";
import type { AdminBook } from "@/lib/types";
import BytesProgress from "./BytesProgress";

/** "Subir PDF original" / "Quitar PDF original" for an existing book. The PDF's page count has to equal the book's. */
export default function OriginalPanel({ book, onChanged }: { book: AdminBook; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OriginalProgress | null>(null);
  const [err, setErr] = useState("");
  const [askRemove, setAskRemove] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = hasPendingOriginal(book.id);

  async function upload(file: File) {
    setErr(""); setProgress(null); setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    try {
      const meta = await readPdfMeta(file); // reads the page count and labels without loading the whole file
      if (meta.pageCount !== book.page_count) {
        setErr(`Este PDF tiene ${meta.pageCount} páginas y el libro tiene ${book.page_count}. Tiene que ser el mismo PDF.`);
        return;
      }
      await uploadOriginal({
        bookId: book.id, file, pages: meta.pageCount, pageLabels: stringifyLabels(rangesFromPageLabels(meta.labels)),
        onProgress: setProgress, signal: c.signal,
      });
      toast("ok", "PDF original guardado");
      onChanged();
    } catch (e) {
      if (c.signal.aborted) {
        await abortOriginal(book.id);
        setErr("Subida cancelada.");
      } else {
        setErr(e instanceof Error && /^(Este PDF|Faltan|La subida|El archivo|El número)/.test(e.message) ? e.message : errText(e) === "Algo ha salido mal. Inténtalo de nuevo." ? "La subida ha fallado. Selecciona el mismo PDF para continuar donde se quedó." : errText(e));
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/admin/books/${book.id}/original`, "DELETE");
      toast("ok", "PDF original eliminado");
      setAskRemove(false);
      onChanged();
    } catch (e) {
      toast("error", errText(e));
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-3" data-testid="original-panel">
      <h3 className="text-xl">PDF original</h3>
      {book.original_pdf_size > 0 ? (
        <p className="text-[15px]" data-testid="original-state">Guardado · <span className="tnum">{fmtSize(book.original_pdf_size)}</span>. Las descargas del libro completo lo usan directamente.</p>
      ) : (
        <p className="hint" data-testid="original-state">No hay PDF original guardado. Con él, las descargas son más rápidas. Solo se envía a quien tiene permiso de descarga.</p>
      )}
      {pending && !busy && <p className="hint">Hay una subida del PDF original sin terminar. Selecciona el mismo PDF y solo se enviarán las partes que faltan.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label className={`btn btn-sm ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {book.original_pdf_size > 0 ? "Reemplazar PDF original" : "Subir PDF original"}
          <input ref={input} type="file" accept="application/pdf" className="sr-only" disabled={busy} data-testid="original-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
        {busy && <button type="button" className="btn btn-sm" onClick={() => ctl.current?.abort()}>Cancelar</button>}
        {book.original_pdf_size > 0 && !busy && <button type="button" className="btn btn-sm btn-danger" onClick={() => setAskRemove(true)}>Quitar PDF original</button>}
      </div>
      {(busy || progress) && <BytesProgress p={progress} label={progress ? "Subiendo el PDF original…" : "Leyendo el PDF…"} />}
      {err && !busy && <p role="alert" className="err">{err}</p>}
      <ConfirmDialog open={askRemove} danger title="Quitar PDF original" confirmLabel="Quitar" busy={busy} onCancel={() => setAskRemove(false)} onConfirm={() => void remove()}>
        <p>Se borra el PDF original guardado. Las páginas del libro no cambian y las descargas volverán a generarse a partir de las páginas.</p>
      </ConfirmDialog>
    </div>
  );
}
