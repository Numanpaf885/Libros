"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { MAX_LABEL, type Bookmark } from "@/lib/client/bookmarks";
import { peekPage } from "@/lib/client/pages";

function short(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("es-ES", same ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** A small thumbnail of the page, only when it is already decoded in the cache (never starts a request). */
function Thumb({ slug, n }: { slug: string; n: number }) {
  const c = useRef<HTMLCanvasElement>(null);
  const [has, setHas] = useState(false);
  useEffect(() => {
    const bmp = peekPage(slug, n);
    const el = c.current;
    if (!bmp || !el) return;
    el.width = 72; el.height = Math.round((72 * bmp.height) / bmp.width);
    el.getContext("2d")?.drawImage(bmp, 0, 0, el.width, el.height);
    setHas(true);
  }, [slug, n]);
  return (
    <span className="grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line bg-surface" aria-hidden="true">
      <canvas ref={c} className={`h-full w-full object-cover ${has ? "" : "hidden"}`} />
      {!has && <Icon name="bookmark" size={16} className="text-muted" />}
    </span>
  );
}

interface Props {
  slug: string;
  items: Bookmark[];
  current: number;
  onJump: (page: number) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}

/** The list itself: used inside a bottom sheet on phones and a side panel on desktop. Labels are rendered as text only. */
export default function BookmarksPanel({ slug, items, current, onJump, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const save = () => { if (editing) { onRename(editing, draft); setEditing(null); } };

  if (!items.length) {
    return (
      <div className="px-5 py-10 text-center">
        <Icon name="bookmark" size={32} className="mx-auto mb-3 text-muted" />
        <p className="text-[15px] text-muted">Aún no tienes marcadores. Toca el icono del marcador para guardar una página.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line" data-testid="bookmark-list">
      {items.map((b) => (
        <li key={b.id} className="px-3 py-2" data-page={b.page}>
          {editing === b.id ? (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <label htmlFor={`bm-${b.id}`} className="sr-only">Nombre del marcador</label>
              <input
                id={`bm-${b.id}`} ref={input} value={draft} maxLength={MAX_LABEL} autoComplete="off" className="field min-h-11 min-w-0 flex-1"
                onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }}
              />
              <button type="submit" className="btn btn-primary btn-sm min-h-11">Guardar</button>
              <button type="button" className="btn btn-sm min-h-11" onClick={() => setEditing(null)}>Cancelar</button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onJump(b.page)} className="press flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-ctl px-1 text-left hover:bg-fg/5" aria-current={b.page === current ? "page" : undefined}>
                <Thumb slug={slug} n={b.page} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{b.label}</span>
                  <span className="tnum block truncate text-sm text-muted">Pág. {b.page}{b.created_at ? ` · ${short(b.created_at)}` : ""}</span>
                </span>
              </button>
              <button type="button" className="btn btn-icon min-h-11! min-w-11! border-transparent bg-transparent!" aria-label={`Cambiar el nombre de «${b.label}»`} title="Cambiar nombre" onClick={() => { setDraft(b.label); setEditing(b.id); }}><Icon name="edit" size={18} /></button>
              <button type="button" className="btn btn-icon min-h-11! min-w-11! border-transparent bg-transparent!" aria-label={`Eliminar «${b.label}»`} title="Eliminar" onClick={() => onDelete(b.id)}><Icon name="trash" size={18} /></button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
