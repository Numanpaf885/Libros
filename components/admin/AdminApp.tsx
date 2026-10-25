"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Logo } from "@/components/brand/Logo";
import ErrorState from "@/components/ui/ErrorState";
import Icon from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useToast } from "@/components/ui/Toaster";
import { api, ApiError, AuthError, errText, request } from "@/lib/client/api";
import { fmtDate, fmtSize } from "@/lib/client/format";
import { formatEta, uploadFlow, type Progress as UploadProgress, type UploadMode } from "@/lib/client/upload";
import type { AdminBook } from "@/lib/types";
import DownloadDialog from "@/components/download/DownloadDialog";
import type { ImagePlan } from "@/lib/client/images";
import { abortOriginal, uploadOriginal, type OriginalProgress } from "@/lib/client/multipart";
import { readPdfMeta } from "@/lib/client/render-pdf";
import { parseLabels, rangesFromPageLabels, stringifyLabels } from "@/lib/page-labels";
import BytesProgress from "./BytesProgress";
import OriginalPanel from "./OriginalPanel";
import PageNumbering from "./PageNumbering";
import CodesPanel from "./CodesPanel";
import DownloadsPanel, { DownloadHistory } from "./DownloadsPanel";
import ImagePicker, { useImagePlan } from "./ImagePicker";
import LegalSettingsPanel from "./LegalSettingsPanel";
import MaintenancePanel from "./MaintenancePanel";
import MessagesPanel from "./MessagesPanel";
import SourceSwitch, { type SourceKind } from "./SourceSwitch";
import TextPanel from "./TextPanel";
import UsersPanel from "./UsersPanel";

const phoneQuery = "(max-width: 767px)";
function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(phoneQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}

function ProgressBar({ p, waiting = "Leyendo el PDF…" }: { p: UploadProgress | null; waiting?: string }) {
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="space-y-2" role="status">
      <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label="Progreso de la subida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum text-sm text-muted" data-testid="progress">
        {p ? `${p.done} / ${p.total} páginas · ${pct} % · ${formatEta(p.etaSec)}` : waiting}
      </p>
    </div>
  );
}

/** Runs an upload; Cancelar (or closing the tab) leaves the book in "uploading" so it can be resumed. */
function useUploader(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [err, setErr] = useState("");
  const [orig, setOrig] = useState<OriginalProgress | null>(null);
  const ctl = useRef<AbortController | null>(null);

  /** `original`: also store the PDF itself (fast downloads). `extras`: the sheet has the columns that need. `text`: also store the pages' text. */
  async function start(o: { file?: File; images?: ImagePlan; mode: UploadMode; bookId?: string; meta?: { title: string; description: string; author?: string; category?: string; year?: string }; status?: "published" | "draft"; original?: boolean; extras?: boolean; text?: boolean }) {
    const { original, extras, ...flow } = o;
    ctl.current = new AbortController();
    setBusy(true); setErr(""); setProgress(null); setOrig(null);
    try {
      const bookId = await uploadFlow({ status: "draft", ...flow, text: !!flow.text && !!flow.file, onProgress: setProgress, signal: ctl.current.signal });
      toast("ok", "Libro subido correctamente");
      // After the pages are stored (the book is complete and usable): printed page numbers found in the PDF, then the original.
      if (flow.file && extras) {
        let labels = "";
        try {
          const meta = await readPdfMeta(flow.file);
          labels = stringifyLabels(rangesFromPageLabels(meta.labels));
          if (labels) await api(`/api/admin/books/${bookId}/labels`, "PUT", { page_labels: labels });
          if (original) {
            await uploadOriginal({ bookId, file: flow.file, pages: meta.pageCount, pageLabels: labels, onProgress: setOrig, signal: ctl.current.signal });
            toast("ok", "PDF original guardado");
          }
        } catch (e) {
          if (original) {
            if (ctl.current.signal.aborted) {
              await abortOriginal(bookId);
              const m = "Subida del PDF original cancelada. El libro ya está subido; puedes añadirlo después con «PDF original».";
              setErr(m); toast("error", m);
            } else {
              const m = "El libro se ha subido, pero el PDF original no. Abre «PDF original» en el libro y selecciona el mismo PDF para continuar.";
              setErr(m); toast("error", m);
            }
          } else void e;
        }
      }
    } catch (e) {
      const what = o.images ? "las mismas imágenes en el mismo orden" : "el mismo PDF";
      const m = ctl.current.signal.aborted
        ? `Subida cancelada. Lo subido se conserva: pulsa «Continuar subida» en el libro y selecciona ${what}.`
        : e instanceof ApiError || e instanceof AuthError ? e.message
        : e instanceof Error && /not the file/.test(e.message) ? (o.images ? "Estas imágenes no son las de la subida empezada (mismos archivos, mismo orden)." : "Este no es el archivo con el que empezó la subida.")
        : e instanceof Error && /different file/.test(e.message) ? "Ya hay una sustitución en curso con otro archivo. Descártala primero."
        : e instanceof Error && /^No se puede leer la imagen/.test(e.message) ? e.message
        : "La subida ha fallado. Inténtalo de nuevo.";
      setErr(m);
      toast("error", m);
    }
    onDone(); // refresh: an interrupted row stays "uploading" and can be resumed
    setBusy(false);
  }
  return { busy, progress, orig, err, start, cancel: () => ctl.current?.abort() };
}

function UploadCard({ onDone, phone, extras, text }: { onDone: () => void; phone: boolean; extras: boolean; text: boolean }) {
  const up = useUploader(onDone);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [source, setSource] = useState<SourceKind>("pdf");
  const [keepOriginal, setKeepOriginal] = useState(true); // also store the PDF itself (fast downloads)
  const imgs = useImagePlan();
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => { if (f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name))) setFile(f); };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (source === "images" ? !imgs.plan : !file) return;
        await up.start({ ...(source === "images" ? { images: imgs.plan! } : { file: file! }), mode: "new", status, meta: { title, description, author, category, year }, extras, text, original: extras && source === "pdf" && keepOriginal });
        setFile(null); setTitle(""); setDescription(""); setAuthor(""); setCategory(""); setYear("");
        imgs.reset();
        if (input.current) input.current.value = "";
      }}
      className="card space-y-5 p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Subir un libro nuevo</h2>
        <SourceSwitch value={source} onChange={setSource} disabled={up.busy} />
      </div>
      {phone && source === "pdf" && <p role="alert" className="rounded-card border border-accent bg-accent/10 p-3 text-[15px]">Para subir libros necesitas un ordenador. Las páginas se preparan en el navegador y un móvil no tiene potencia suficiente.</p>}

      {source === "images" ? <ImagePicker state={imgs} disabled={up.busy} /> : <label
        htmlFor="pdf-file"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-9 text-center transition-colors duration-150 focus-within:border-accent ${over ? "border-accent bg-accent/10" : "border-line-strong hover:border-accent/70"}`}
      >
        <Icon name="upload" size={30} className="text-accent" />
        {file ? (
          <>
            <span className="font-medium">{file.name}</span>
            <span className="hint">{fmtSize(file.size)} · haz clic o suelta otro PDF para cambiarlo</span>
          </>
        ) : (
          <>
            <span className="font-medium">Suelta aquí tu PDF o haz clic para elegirlo</span>
            <span className="hint">El PDF se lee desde tu disco y nunca se sube; solo se envían las imágenes de las páginas.</span>
          </>
        )}
        <input ref={input} id="pdf-file" name="pdf" type="file" accept="application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="up-title" className="label">Título</label>
          <input id="up-title" name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor="up-status" className="label">Estado al terminar</label>
          <select id="up-status" name="status" value={status} onChange={(e) => setStatus(e.target.value as "draft" | "published")} className="field">
            <option value="published">Publicado</option>
            <option value="draft">Borrador</option>
          </select>
        </div>
        <div>
          <label htmlFor="up-author" className="label">Autor <span className="font-normal text-muted">(opcional)</span></label>
          <input id="up-author" name="author" maxLength={120} value={author} onChange={(e) => setAuthor(e.target.value)} className="field" />
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <div>
            <label htmlFor="up-cat" className="label">Categoría <span className="font-normal text-muted">(opcional)</span></label>
            <input id="up-cat" name="category" maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} className="field" />
          </div>
          <div>
            <label htmlFor="up-year" className="label">Año</label>
            <input id="up-year" name="year" inputMode="numeric" pattern="\d{4}" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} className="field" />
          </div>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="up-desc" className="label">Descripción</label>
          <textarea id="up-desc" name="description" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
        </div>
      </div>

      {extras && source === "pdf" && (
        <label className="flex min-h-11 items-start gap-3 text-[15px]">
          <input type="checkbox" name="keep-original" checked={keepOriginal} disabled={up.busy} onChange={(e) => setKeepOriginal(e.target.checked)} className="mt-1" />
          <span>Guardar también el PDF original (descargas rápidas)<span className="hint block">Se sube aparte, por partes, después de las páginas. Solo lo recibe quien descarga el libro.</span></span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button aria-busy={up.busy} disabled={up.busy || (source === "images" ? !imgs.plan : !file) || !title.trim()} className="btn btn-primary">Subir libro</button>
        {up.busy && <button type="button" className="btn" onClick={up.cancel}>Cancelar</button>}
      </div>
      {(up.busy || up.progress) && <ProgressBar p={up.progress} waiting={source === "images" ? "Preparando las imágenes…" : undefined} />}
      {up.orig && <BytesProgress p={up.orig} />}
      {up.err && !up.busy && <p role="alert" className="err">{up.err}</p>}
    </form>
  );
}

const CHIP: Record<AdminBook["status"], [string, string]> = {
  published: ["chip chip-ok", "Publicado"],
  draft: ["chip chip-draft", "Borrador"],
  uploading: ["chip chip-busy", "Subiendo"],
};
type PanelName = "edit" | "codes" | "replace" | "delete" | "history" | "original" | "numbering" | "text";
const GRID = "md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_6.5rem_6.5rem_7rem_20rem] md:items-center md:gap-4";

function BookRow({ book, reload, phone, dl, extras, text }: { book: AdminBook; reload: () => void; phone: boolean; dl: boolean; extras: boolean; text: boolean }) {
  const toast = useToast();
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const up = useUploader(reload);
  const [source, setSource] = useState<SourceKind>("pdf");
  const imgs = useImagePlan();
  const [askDownload, setAskDownload] = useState(false);
  const uploading = book.status === "uploading";
  /** resume an interrupted upload, continue a pending replacement, or start a replacement */
  const startReplace = (src: { file: File } | { images: ImagePlan }) =>
    up.start(uploading ? { ...src, mode: "resume", bookId: book.id, extras, text }
      : book.pending_replacement ? { ...src, mode: "resume", bookId: book.pending_replacement, status: "published", extras, text }
      : { ...src, mode: "replace", bookId: book.id, extras, text });
  const toggle = (p: PanelName) => setPanel(panel === p ? null : p);
  const [chipClass, chipText] = CHIP[book.status];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast("error", errText(e)); }
    setBusy(false);
  };

  return (
    <li role="row" className="card p-4 md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:bg-transparent md:p-3 md:shadow-none first:md:border-t-0">
      <div className={`flex flex-col gap-3 ${GRID}`}>
        <div className="flex items-center gap-3 md:contents">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/admin/books/${book.id}/cover?v=${encodeURIComponent(book.updated_at)}`} alt="" width={56} height={84} className="h-[84px] w-14 shrink-0 rounded-md border border-line bg-surface object-cover md:h-[60px] md:w-10" />
          <div role="cell" className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-2xl font-semibold leading-tight">{book.title}</h3>
            <p className="truncate text-sm text-muted">{book.author ? `${book.author} · ` : ""}/b/{book.slug}</p>
          </div>
        </div>
        <div role="cell" className="flex items-center gap-3 text-sm text-muted md:contents">
          <span className={`${chipClass} w-fit`}>{chipText}</span>
          <span className="tnum md:text-fg">{book.page_count} páginas</span>
          <span className="tnum">{fmtDate(book.updated_at)}</span>
        </div>
        <div role="cell" className="flex flex-wrap gap-2 md:justify-end">
          {uploading ? (
            <button className="btn btn-sm" onClick={() => toggle("replace")}>Continuar subida</button>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => toggle("edit")}>Editar</button>
              <button className="btn btn-sm" onClick={() => toggle("codes")}>Códigos</button>
              <button className="btn btn-sm" onClick={() => toggle("replace")}>{book.pending_replacement ? "Continuar sustitución" : "Sustituir PDF"}</button>
              {dl && <button className="btn btn-sm" onClick={() => setAskDownload(true)}><Icon name="download" size={16} />Descargar</button>}
              {dl && <button className="btn btn-sm" onClick={() => toggle("history")}>Historial</button>}
              {extras && <button className="btn btn-sm" onClick={() => toggle("original")}>PDF original</button>}
              {extras && <button className="btn btn-sm" onClick={() => toggle("numbering")}>Numeración</button>}
              {text && <button className="btn btn-sm" onClick={() => toggle("text")}>Texto</button>}
            </>
          )}
          <button className="btn btn-sm btn-danger" onClick={() => { setConfirm(""); setAskDelete(true); }}>Eliminar</button>
        </div>
      </div>

      {panel && (
        <div role="cell" className="mt-4 border-t border-line pt-4">
          {panel === "edit" && (
            <form className="grid max-w-2xl grid-cols-1 gap-4" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api(`/api/admin/books/${book.id}`, "PATCH", { title: f.get("title"), description: f.get("description"), author: f.get("author"), category: f.get("category"), year: f.get("year"), status: f.get("status") });
                toast("ok", "Cambios guardados"); setPanel(null); reload();
              });
            }}>
              <div><label className="label" htmlFor={`t-${book.id}`}>Título</label><input id={`t-${book.id}`} name="title" defaultValue={book.title} required maxLength={200} className="field" /></div>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_7rem]">
                <div><label className="label" htmlFor={`a-${book.id}`}>Autor</label><input id={`a-${book.id}`} name="author" defaultValue={book.author} maxLength={120} className="field" /></div>
                <div><label className="label" htmlFor={`c-${book.id}`}>Categoría</label><input id={`c-${book.id}`} name="category" defaultValue={book.category} maxLength={80} className="field" /></div>
                <div><label className="label" htmlFor={`y-${book.id}`}>Año</label><input id={`y-${book.id}`} name="year" defaultValue={book.year} inputMode="numeric" pattern="\d{4}" maxLength={4} className="field" /></div>
              </div>
              <div><label className="label" htmlFor={`d-${book.id}`}>Descripción</label><textarea id={`d-${book.id}`} name="description" defaultValue={book.description} rows={2} maxLength={2000} className="field" /></div>
              <div className="max-w-xs"><label className="label" htmlFor={`s-${book.id}`}>Estado</label>
                <select id={`s-${book.id}`} name="status" defaultValue={book.status} className="field"><option value="draft">Borrador</option><option value="published">Publicado</option></select></div>
              <div><button disabled={busy} className="btn btn-primary">Guardar cambios</button></div>
            </form>
          )}

          {panel === "replace" && (
            <div className={`${source === "images" ? "max-w-4xl" : "max-w-2xl"} space-y-3`}>
              <SourceSwitch value={source} onChange={setSource} disabled={up.busy} />
              {phone && source === "pdf" && <p role="alert" className="rounded-card border border-accent bg-accent/10 p-3 text-[15px]">Para subir libros necesitas un ordenador.</p>}
              <p className="hint">
                {uploading
                  ? `Esta subida se interrumpió. Selecciona ${source === "images" ? "las mismas imágenes en el mismo orden" : "el mismo PDF"} y solo se enviarán las páginas que faltan.`
                  : book.pending_replacement
                    ? `Hay una sustitución en curso. Selecciona ${source === "images" ? "las mismas imágenes en el mismo orden" : "el mismo PDF"} para continuar; mientras tanto el libro sigue mostrando las páginas antiguas.`
                    : "Las páginas nuevas se suben primero a otra ubicación; las antiguas se borran solo cuando todo está listo."}
                {extras && source === "pdf" && !uploading && " Se guardan los números de página impresos que traiga el PDF. El PDF original guardado se borra al terminar: súbelo de nuevo en «PDF original»."}
              </p>
              {source === "pdf" ? (
                <input type="file" accept="application/pdf" disabled={up.busy} className="block w-full text-sm text-muted file:mr-3 file:rounded-ctl file:border file:border-line-strong file:bg-surface file:px-4 file:py-2 file:text-fg"
                  aria-label="Archivo PDF"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void startReplace({ file });
                  }} />
              ) : (
                <>
                  <ImagePicker state={imgs} disabled={up.busy} />
                  {imgs.plan && <button type="button" aria-busy={up.busy} disabled={up.busy} className="btn btn-primary" onClick={() => void startReplace({ images: imgs.plan! })}>{uploading ? "Continuar subida" : book.pending_replacement ? "Continuar sustitución" : "Sustituir con estas imágenes"}</button>}
                </>
              )}
              {up.busy && <button className="btn btn-sm" onClick={up.cancel}>Cancelar</button>}
              {(up.busy || up.progress) && <ProgressBar p={up.progress} waiting={source === "images" ? "Preparando las imágenes…" : undefined} />}
              {up.err && !up.busy && <p role="alert" className="err">{up.err}</p>}
              {book.pending_replacement && !uploading && !up.busy && (
                <button className="btn btn-sm btn-danger" onClick={() => run(async () => { await api(`/api/admin/books/${book.pending_replacement}`, "DELETE", { title: book.title }); toast("ok", "Sustitución descartada"); reload(); })}>
                  Descartar sustitución
                </button>
              )}
            </div>
          )}

          {panel === "history" && <DownloadHistory filter={{ book: book.id }} />}

          {panel === "original" && extras && <OriginalPanel book={book} onChanged={reload} />}

          {panel === "numbering" && extras && <PageNumbering book={book} onSaved={reload} />}

          {panel === "text" && text && <TextPanel book={book} />}

          {panel === "codes" && <CodesPanel book={book} onBookChanged={reload} />}
        </div>
      )}

      {dl && <DownloadDialog open={askDownload} onClose={() => setAskDownload(false)} bookTitle={book.title} slug={book.slug} pageCount={book.page_count} mode="admin" bookId={book.id} labels={parseLabels(book.page_labels, book.page_count)} />}
      <ConfirmDialog
        open={askDelete} danger title="Eliminar libro" confirmLabel="Eliminar para siempre" busy={busy} confirmDisabled={confirm !== book.title}
        onCancel={() => setAskDelete(false)}
        onConfirm={() => run(async () => { await abortOriginal(book.id); await api(`/api/admin/books/${book.id}`, "DELETE", { title: confirm }); setAskDelete(false); toast("ok", "Libro eliminado"); reload(); })}
      >
        <p>Se borrarán de forma permanente las páginas, la fila de la hoja y todos sus códigos. Escribe <strong className="text-fg">{book.title}</strong> para confirmar.</p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" aria-label="Escribe el título del libro para confirmar" autoComplete="off" />
      </ConfirmDialog>
    </li>
  );
}

export default function AdminApp({ siteName }: { siteName: string }) {
  const router = useRouter();
  const toast = useToast();
  const phone = useIsPhone();
  const [books, setBooks] = useState<AdminBook[] | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<"books" | "users" | "downloads" | "messages" | "legal" | "maintenance">("books");
  const [extras, setExtras] = useState(false); // the sheet has books.page_labels / original_pdf_* (original PDF + page numbering)
  const [dl, setDl] = useState(false); // the download features exist (sheet has the downloads tab and users.can_download)
  const [schema, setSchema] = useState(0); // bumped when "Actualizar base de datos" changed the sheet: features are looked up again
  const [text, setText] = useState(false); // the sheet has books.text_status / text_pages / allow_copy (selectable text)
  const [unread, setUnread] = useState(0); // contact messages still "nuevo" (badge on "Mensajes")
  const [legalDone, setLegalDone] = useState(true); // the owner and contact email for the legal pages are filled in
  const load = () => setVersion((v) => v + 1);
  const [booksErr, setBooksErr] = useState(""); // the book list could not be loaded: "Reintentar"
  const [outdated, setOutdated] = useState(false); // the sheet lacks tabs or columns: some features are hidden

  useEffect(() => {
    let dead = false;
    api<{ books: AdminBook[]; extras?: boolean }>("/api/admin/books")
      .then((r) => { if (!dead) { setBooks(r.books); setExtras(!!r.extras); setBooksErr(""); } })
      .catch((e) => {
        if (dead) return;
        if (e instanceof AuthError) router.replace("/admin/login");
        else setBooksErr(errText(e));
      });
    return () => { dead = true; };
  }, [version, router, toast]);

  useEffect(() => {
    let dead = false;
    api<{ available: boolean }>("/api/admin/downloads?size=1").then((r) => { if (!dead) setDl(r.available); }).catch(() => {});
    api<{ ready: boolean }>("/api/admin/text").then((r) => { if (!dead) setText(r.ready); }).catch(() => {});
    api<{ unread: number }>("/api/admin/messages?size=1").then((r) => { if (!dead) setUnread(r.unread); }).catch(() => {});
    api<{ available: boolean; complete?: boolean }>("/api/admin/settings").then((r) => { if (!dead) setLegalDone(!!r.complete); }).catch(() => {});
    request("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h: { sheets?: { tabs_missing: string[]; columns_missing: Record<string, string[]> } }) => {
      if (!dead && h.sheets) setOutdated(h.sheets.tabs_missing.length > 0 || Object.keys(h.sheets.columns_missing).length > 0);
    }).catch(() => {});
    return () => { dead = true; };
  }, [schema]);
  // Download history and contact messages are kept 12 months (as /privacidad says): older rows go, at most once a day.
  useEffect(() => { api("/api/admin/retention", "POST").catch(() => {}); }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-8 px-4 pb-20 pt-6 sm:px-6">
      <header className="flex items-center justify-between gap-3 border-b border-line pb-6">
        <div className="min-w-0">
          <Link href="/" className="font-serif text-2xl font-semibold">{siteName}</Link>
          <h1 className="mt-1 text-3xl [overflow-wrap:anywhere] sm:text-4xl">Administración</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <button className="btn" onClick={signOut}>Salir</button>
        </div>
      </header>

      {outdated && tab !== "maintenance" && (
        <div role="status" className="panel flex flex-wrap items-center justify-between gap-3 border-accent p-4" data-testid="outdated-banner">
          <p className="min-w-0 flex-1 basis-64 text-[15px]"><strong className="font-semibold">Actualiza la base de datos en Mantenimiento.</strong> A la hoja de cálculo le faltan pestañas o columnas: las funciones que las usan están ocultas hasta entonces.</p>
          <button type="button" className="btn btn-sm" onClick={() => setTab("maintenance")}>Ir a Mantenimiento</button>
        </div>
      )}
      {!legalDone && tab !== "legal" && (
        <div role="status" className="panel flex flex-wrap items-center justify-between gap-3 border-accent p-4" data-testid="legal-banner">
          <p className="min-w-0 flex-1 basis-64 text-[15px]"><strong className="font-semibold">Completa los datos legales.</strong> Las páginas de Privacidad, Cookies y Aviso legal necesitan tu nombre y un email de contacto.</p>
          <button type="button" className="btn btn-sm" onClick={() => setTab("legal")}>Ir a Ajustes legales</button>
        </div>
      )}

      <div role="tablist" aria-label="Secciones" className="flex flex-wrap gap-2">
        {([["books", "Libros"], ["users", "Usuarios"], ...(dl ? [["downloads", "Descargas"] as const] : []), ["messages", "Mensajes"], ["legal", "Ajustes legales"], ["maintenance", "Mantenimiento"]] as const).map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}
            className={`btn min-h-11 ${tab === id ? "btn-primary" : ""}`}>
            {label}
            {id === "messages" && unread > 0 && (
              <span className="tnum ml-0.5 inline-flex min-w-6 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold leading-6 text-bg" data-testid="unread-badge" aria-label={`${unread} sin leer`}>{unread > 99 ? "99+" : unread}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "maintenance" ? (
        <div role="tabpanel" id="panel-maintenance" aria-labelledby="tab-maintenance">
          <MaintenancePanel onChanged={() => { setSchema((v) => v + 1); load(); }} />
        </div>
      ) : tab === "downloads" && dl ? (
        <div role="tabpanel" id="panel-downloads" aria-labelledby="tab-downloads">
          <DownloadsPanel />
        </div>
      ) : tab === "messages" ? (
        <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages">
          <MessagesPanel key={schema} onUnread={setUnread} />
        </div>
      ) : tab === "legal" ? (
        <div role="tabpanel" id="panel-legal" aria-labelledby="tab-legal">
          <LegalSettingsPanel key={schema} onSaved={setLegalDone} />
        </div>
      ) : tab === "users" ? (
        <div role="tabpanel" id="panel-users" aria-labelledby="tab-users">
          <UsersPanel books={(books ?? []).filter((b) => b.status !== "uploading")} />
        </div>
      ) : (
      <div role="tabpanel" id="panel-books" aria-labelledby="tab-books" className="space-y-8">
      <UploadCard onDone={load} phone={phone} extras={extras} text={text} />

      {books === null && booksErr ? (
        <ErrorState title="No se han podido cargar los libros" text={booksErr} onRetry={() => { setBooksErr(""); load(); }} />
      ) : books === null ? (
        <div className="space-y-3" aria-label="Cargando"><div className="skeleton h-28 rounded-card" /><div className="skeleton h-28 rounded-card" /></div>
      ) : books.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center"><Logo size={40} className="text-accent" /><h2 className="text-3xl">Todavía no hay libros</h2><p className="text-muted">Sube tu primer PDF arriba para empezar.</p></div>
      ) : (
        <section aria-label="Libros">
          <div role="table" aria-label="Libros" className="md:card md:overflow-hidden">
            <div role="row" className={`hidden border-b border-line bg-surface/60 px-3 py-2.5 text-sm text-muted ${GRID}`}>
              <span role="columnheader" className="sr-only">Portada</span>
              <span role="columnheader">Título</span><span role="columnheader">Estado</span><span role="columnheader">Páginas</span><span role="columnheader">Actualizado</span><span role="columnheader" className="text-right">Acciones</span>
            </div>
            <ul role="rowgroup" className="space-y-3 md:space-y-0">
              {books.map((b) => <BookRow key={b.id} book={b} reload={load} phone={phone} dl={dl} extras={extras} text={text} />)}
            </ul>
          </div>
        </section>
      )}
      </div>
      )}
    </main>
  );
}
