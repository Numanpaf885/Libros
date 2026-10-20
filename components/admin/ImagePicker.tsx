"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { acceptFiles, byDate, byName, IMAGE_ACCEPT, makeThumb, MAX_IMAGES, type ImageItem, type ImagePlan, type Rotation } from "@/lib/client/images";

/** The photos chosen so far, their order and the cover. `plan` is what the uploader needs. */
export function useImagePlan() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [cover, setCover] = useState("");
  const [message, setMessage] = useState("");
  const coverId = items.some((i) => i.id === cover) ? cover : (items[0]?.id ?? "");
  const add = useCallback((files: File[]) => {
    setItems((cur) => {
      const r = acceptFiles(files, cur);
      setMessage(r.message);
      return r.items.length ? [...cur, ...r.items] : cur;
    });
  }, []);
  const plan: ImagePlan | null = useMemo(() => (items.length ? { items, coverId } : null), [items, coverId]);
  const reset = useCallback(() => { setItems([]); setCover(""); setMessage(""); }, []);
  return { items, setItems, coverId, setCover, message, setMessage, add, plan, reset };
}
export type ImagePlanState = ReturnType<typeof useImagePlan>;

// ---- thumbnails: made when a cell scrolls into view, 3 at a time, at most 300 kept ----
const thumbs = new Map<string, string>();
const waiting: (() => void)[] = [];
let running = 0;
function pump() {
  while (running < 3 && waiting.length) { running++; waiting.shift()!(); }
}
function useThumb(item: ImageItem): string | null {
  const key = `${item.id}:${item.rot}`;
  const [url, setUrl] = useState<string | null>(() => thumbs.get(key) ?? null);
  useEffect(() => {
    const hit = thumbs.get(key);
    if (hit) { setUrl(hit); return; } // eslint-disable-line react-hooks/set-state-in-effect
    let dead = false;
    const job = () => {
      makeThumb(item).then((u) => {
        thumbs.set(key, u);
        while (thumbs.size > 300) { const old = thumbs.keys().next().value as string; URL.revokeObjectURL(thumbs.get(old)!); thumbs.delete(old); }
        if (!dead) setUrl(u);
      }, () => {}).finally(() => { running--; pump(); });
    };
    const entry = () => { if (dead) { running--; pump(); } else job(); };
    waiting.push(entry);
    pump();
    return () => { dead = true; };
  }, [key, item]);
  return url;
}
function clearThumbs() { for (const u of thumbs.values()) URL.revokeObjectURL(u); thumbs.clear(); }

const GAP = 10;
const MIN_CELL = 140;
const FOOT = 44;
const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to) return list;
  const out = list.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
};

function Cell({ item, index, n, cover, w, grabbed, target, onRotate, onRemove, onCover, onGripDown, onKey }: {
  item: ImageItem; index: number; n: number; cover: boolean; w: number; grabbed: boolean; target: boolean;
  onRotate: () => void; onRemove: () => void; onCover: () => void; onGripDown: (e: React.PointerEvent) => void; onKey: (e: React.KeyboardEvent) => void;
}) {
  const url = useThumb(item);
  const label = `Página ${index + 1} de ${n}: ${item.file.name}`;
  return (
    <div
      role="group" aria-label={label} aria-roledescription="imagen reordenable" tabIndex={0} data-idx={index} data-id={item.id} onKeyDown={onKey}
      className={`flex h-full flex-col overflow-hidden rounded-card border bg-bg outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${grabbed ? "border-accent shadow-[var(--shadow-float)]" : target ? "border-accent" : "border-line"} ${target ? "ring-2 ring-accent" : ""}`}
    >
      <div className="relative min-h-0 flex-1 bg-surface" style={{ height: w * 1.25 }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        ) : <div className="skeleton absolute inset-0" />}
        <span className="tnum absolute bottom-1 left-1 rounded-[4px] bg-bg/90 px-1.5 py-0.5 text-xs font-semibold">{index + 1}</span>
        {cover && <span className="absolute right-1 top-1 rounded-[4px] bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-fg">Portada</span>}
        <button type="button" onPointerDown={onGripDown} aria-label={`Arrastrar la página ${index + 1}`} title="Arrastrar para reordenar" tabIndex={-1}
          className="btn btn-icon absolute left-1 top-1 min-h-9! min-w-9! cursor-grab touch-none border-transparent bg-bg/90! active:cursor-grabbing"><Icon name="grip" size={18} /></button>
      </div>
      <div className="flex items-center justify-around" style={{ height: FOOT }}>
        <button type="button" onClick={onRotate} aria-label={`Girar 90° la página ${index + 1}`} title="Girar 90°" className="btn btn-icon btn-ghost min-h-10! min-w-10!"><Icon name="rotate" size={18} /></button>
        <button type="button" onClick={onCover} aria-pressed={cover} aria-label={`Usar la página ${index + 1} como portada`} title="Usar como portada" className={`btn btn-icon btn-ghost min-h-10! min-w-10! ${cover ? "text-accent" : ""}`}><Icon name="star" size={18} filled={cover} /></button>
        <button type="button" onClick={onRemove} aria-label={`Quitar la página ${index + 1}`} title="Quitar" className="btn btn-icon btn-ghost min-h-10! min-w-10!"><Icon name="trash" size={18} /></button>
      </div>
    </div>
  );
}

/** Thumbnail grid (virtualised) to choose, order, rotate and remove the photos of a book. */
export function ImageOrderEditor({ state, disabled }: { state: ImagePlanState; disabled?: boolean }) {
  const { items, setItems, coverId, setCover, message, add } = state;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, top: 0 });
  const [drag, setDrag] = useState<{ id: string; to: number; x: number; y: number } | null>(null);
  const [held, setHeld] = useState<{ id: string; from: number } | null>(null);
  const [note, setNote] = useState("");
  const focusId = useRef<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const n = items.length;

  useEffect(() => clearThumbs, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight, top: el.scrollTop }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((Math.max(view.w, MIN_CELL) + GAP) / (MIN_CELL + GAP)));
  const cell = Math.max(80, (view.w - GAP * (cols - 1) - 2) / cols);
  const rowH = cell * 1.25 + FOOT + 2 + GAP;
  const rows = Math.ceil(n / cols);
  const first = Math.max(0, Math.floor(view.top / rowH) - 1);
  const last = Math.min(rows - 1, Math.ceil((view.top + view.h) / rowH) + 1);

  const scrollToIndex = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = Math.floor(i / cols) * rowH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
  }, [cols, rowH]);
  // after a keyboard move the cell may have been re-created: put the focus back on it
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) { el.focus({ preventScroll: true }); focusId.current = null; }
  });

  const set = (next: ImageItem[], say?: string) => { setItems(next); if (say) setNote(say); };
  const reverse = () => set(items.slice().reverse(), "Orden invertido");
  const sortName = () => set(items.slice().sort(byName), "Ordenadas por nombre");
  const sortDate = () => set(items.slice().sort(byDate), "Ordenadas por fecha");
  const rotate = (id: string) => set(items.map((i) => (i.id === id ? { ...i, rot: ((i.rot + 90) % 360) as Rotation } : i)));
  const remove = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    const next = items.filter((x) => x.id !== id);
    set(next, `Página ${i + 1} quitada. Quedan ${next.length}.`);
    const nb = next[Math.min(i, next.length - 1)];
    if (nb) focusId.current = nb.id;
  };

  // ---- pointer drag (mouse, pen and touch): from the grip of a cell ----
  const indexAt = (clientX: number, clientY: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    const col = Math.min(cols - 1, Math.max(0, Math.floor((clientX - r.left + el.scrollLeft) / (cell + GAP))));
    const row = Math.max(0, Math.floor((clientY - r.top + el.scrollTop) / rowH));
    return Math.min(n - 1, row * cols + col);
  };
  const dragRef = useRef(drag);
  useEffect(() => { dragRef.current = drag; });
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    setDrag({ id, to: indexAt(x, y), x, y });
    let raf = 0;
    let pos = { x, y };
    const tick = () => {
      const el = scroller.current;
      if (el && dragRef.current) {
        const r = el.getBoundingClientRect();
        if (pos.y < r.top + 48) el.scrollTop -= 14;
        else if (pos.y > r.bottom - 48) el.scrollTop += 14;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move_ = (ev: PointerEvent) => { pos = { x: ev.clientX, y: ev.clientY }; setDrag((d) => (d ? { ...d, to: indexAt(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY } : d)); };
    const end = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move_);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const d = dragRef.current;
      setDrag(null);
      if (!d || ev.type === "pointercancel") return;
      const from = items.findIndex((i) => i.id === id);
      const to = indexAt(ev.clientX, ev.clientY);
      if (from >= 0 && to !== from) set(move(items, from, to), `Página ${from + 1} movida a la posición ${to + 1} de ${n}.`);
    };
    window.addEventListener("pointermove", move_);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // ---- keyboard: Espacio/Intro agarra y suelta, flechas mueven, Esc cancela, Supr quita ----
  const onKey = (item: ImageItem, i: number) => (e: React.KeyboardEvent) => {
    if (disabled || e.target !== e.currentTarget) return;
    const grabbed = held?.id === item.id;
    const go = (to: number) => {
      const t = Math.min(n - 1, Math.max(0, to));
      if (t === i) return;
      set(move(items, i, t), `Página movida a la posición ${t + 1} de ${n}.`);
      focusId.current = item.id;
      scrollToIndex(t);
    };
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed) { setHeld(null); setNote(`Página soltada en la posición ${i + 1} de ${n}.`); }
      else { setHeld({ id: item.id, from: i }); setNote(`Página ${i + 1} agarrada. Usa las flechas para moverla, Espacio para soltarla y Escape para cancelar.`); }
    } else if (e.key === "Escape" && grabbed) {
      e.preventDefault();
      e.stopPropagation();
      set(move(items, i, held!.from), "Movimiento cancelado.");
      focusId.current = item.id;
      scrollToIndex(held!.from);
      setHeld(null);
    } else if (grabbed && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      go(e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" ? i - cols : e.key === "ArrowDown" ? i + cols : e.key === "Home" ? 0 : n - 1);
    } else if (!grabbed && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const t = Math.min(n - 1, Math.max(0, e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" ? i - cols : i + cols));
      focusId.current = items[t].id;
      scrollToIndex(t);
      setView((v) => ({ ...v })); // make sure the target cell is rendered and gets the focus
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(item.id);
    } else if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      rotate(item.id);
    }
  };

  const dragged = drag ? items.find((i) => i.id === drag.id) : null;
  const btn = "btn btn-sm";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="tnum mr-auto text-[15px] font-semibold" aria-live="polite" data-testid="image-total">{n} {n === 1 ? "página" : "páginas"}<span className="font-normal text-muted"> · máximo {MAX_IMAGES.toLocaleString("es-ES")}</span></p>
        <button type="button" className={btn} onClick={reverse} disabled={disabled || n < 2}>Invertir orden</button>
        <button type="button" className={btn} onClick={sortName} disabled={disabled || n < 2}>Ordenar por nombre</button>
        <button type="button" className={btn} onClick={sortDate} disabled={disabled || n < 2}>Ordenar por fecha</button>
        <button type="button" className={btn} onClick={() => pick.current?.click()} disabled={disabled || n >= MAX_IMAGES}><Icon name="upload" size={16} />Añadir más</button>
        <input ref={pick} type="file" multiple accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Añadir más imágenes" onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      <p className="hint">Arrastra el asa de cada imagen para cambiar su orden. Con el teclado: enfoca una imagen, pulsa Espacio, muévela con las flechas y vuelve a pulsar Espacio.</p>
      {message && <p role="alert" className="err" data-testid="image-message">{message}</p>}
      <p className="sr-only" role="status" aria-live="polite">{note}</p>
      <div
        ref={scroller} onScroll={(e) => { const top = e.currentTarget.scrollTop; setView((v) => (Math.abs(v.top - top) >= 1 ? { ...v, top } : v)); }}
        className="relative h-[min(62vh,34rem)] overflow-y-auto overflow-x-hidden rounded-card border border-line bg-surface/40 p-0 [overflow-anchor:none]" data-testid="image-grid"
      >
        <div className="relative" style={{ height: Math.max(0, rows * rowH - GAP + 2 * 1), margin: 0 }}>
          {n > 0 && items.slice(first * cols, Math.min(n, (last + 1) * cols)).map((item, k) => {
            const i = first * cols + k;
            return (
              <div key={item.id} className="absolute" style={{ left: (i % cols) * (cell + GAP) + 1, top: Math.floor(i / cols) * rowH + 1, width: cell, height: rowH - GAP }}>
                <Cell
                  item={item} index={i} n={n} cover={item.id === coverId} w={cell}
                  grabbed={held?.id === item.id} target={!!drag && drag.to === i && drag.id !== item.id}
                  onRotate={() => rotate(item.id)} onRemove={() => remove(item.id)} onCover={() => { setCover(item.id); setNote(`Página ${i + 1} es ahora la portada.`); }}
                  onGripDown={startDrag(item.id)} onKey={onKey(item, i)}
                />
              </div>
            );
          })}
        </div>
      </div>
      {drag && dragged && <DragGhost item={dragged} x={drag.x} y={drag.y} />}
    </div>
  );
}

function DragGhost({ item, x, y }: { item: ImageItem; x: number; y: number }) {
  const url = useThumb(item);
  return (
    <div className="pointer-events-none fixed z-[120] h-24 w-20 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card border border-accent bg-bg opacity-90 shadow-[var(--shadow-float)]" style={{ left: x, top: y }} aria-hidden="true">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-contain" />
      )}
    </div>
  );
}

/** The drop area (when no photos are chosen yet) plus the editor. Photos from the gallery work on phones too. */
export default function ImagePicker({ state, disabled }: { state: ImagePlanState; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const { items, add, message } = state;
  if (items.length) return <ImageOrderEditor state={state} disabled={disabled} />;
  return (
    <div className="space-y-2">
      <label
        htmlFor="img-files"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-9 text-center transition-colors duration-150 focus-within:border-accent ${over ? "border-accent bg-accent/10" : "border-line-strong hover:border-accent/70"}`}
      >
        <Icon name="image" size={30} className="text-accent" />
        <span className="font-medium">Suelta aquí tus imágenes o haz clic para elegirlas</span>
        <span className="hint">JPG, PNG o WebP · hasta {MAX_IMAGES.toLocaleString("es-ES")} imágenes · se ordenan por nombre y podrás cambiar el orden antes de subirlas.</span>
        <input id="img-files" name="images" type="file" multiple accept={IMAGE_ACCEPT} disabled={disabled} className="sr-only" onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </label>
      {message && <p role="alert" className="err" data-testid="image-message">{message}</p>}
    </div>
  );
}
