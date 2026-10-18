"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import Sheet, { usePhone } from "@/components/ui/Sheet";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useToast } from "@/components/ui/Toaster";
import { LIMIT, useBookmarks } from "@/lib/client/bookmarks";
import { loadPage, Unauthorized } from "@/lib/client/pages";
import { realPages, unitCount, unitOf, windowUnits } from "@/lib/client/spreads";
import BookMode, { type BookHandle, type PageEffect } from "./BookMode";
import BookmarksPanel from "./BookmarksPanel";
import { flushBook, reportPage } from "@/lib/client/progress-sync";
import ModeSwitch, { type ReadMode } from "./ModeSwitch";
import OpeningBook from "./OpeningBook";
import PageCanvas from "./PageCanvas";

interface Props {
  slug: string;
  title: string;
  pageCount: number;
  /** Page to open on (from #p=N). 1 when none. */
  initialPage: number;
  /** A saved page to OFFER ("Continuar en la página X"); 0 for none. */
  offer: number;
  onClose: () => void;
  onExpired: () => void;
}
type Fit = "width" | "page" | "custom";

const REF_W = 794; // 100% = an A4 page at 96 dpi
const STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const PAD = 16;
const GAP = 12;
const DEFAULT_RATIO = 1.4142;
const tb = "btn btn-icon min-h-11! min-w-11! border-transparent bg-transparent!";
const MODE_KEY = "br:mode";
const EFFECT_KEY = "br:effect";
const EFFECTS: { v: PageEffect; label: string }[] = [{ v: "turn", label: "Pasar página" }, { v: "slide", label: "Deslizar" }, { v: "none", label: "Ninguno" }];
const OPEN_MIN_MS = 1500; // the opening animation lasts at least this long...
const OPEN_MAX_MS = 3300; // ...and never longer (3.3 s + the 0.4 s fade-out < 4 s): after this the pages that are missing show skeletons

const isPhone = () => window.matchMedia("(max-width: 767px), (pointer: coarse) and (max-width: 1000px)").matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function initialEffect(): PageEffect {
  try { const v = localStorage.getItem(EFFECT_KEY); if (v === "turn" || v === "slide" || v === "none") return v; } catch { /* ignore */ }
  return reducedMotion() ? "none" : "turn"; // with reduced motion the default is no effect
}
function initialMode(): ReadMode {
  try { const v = localStorage.getItem(MODE_KEY); if (v === "book" || v === "pdf") return v; } catch { /* ignore */ }
  return isPhone() ? "book" : "pdf"; // Book mode on phones, PDF mode on desktop, until the reader picks one
}

export default function Viewer({ slug, title, pageCount, initialPage, offer: offerIn, onClose, onExpired }: Props) {
  const lsKey = `br:last:${slug}`;
  const [mode, setModeState] = useState<ReadMode>(initialMode);
  const [reduced] = useState(reducedMotion);
  const [effect, setEffectState] = useState<PageEffect>(initialEffect);
  const [fxMenu, setFxMenu] = useState(false);
  const [fit, setFit] = useState<Fit>("width");
  const [menu, setMenu] = useState(false); // phones: secondary controls live in a menu so the toolbar stays on one line
  const [customPct, setCustomPct] = useState(100);
  const [page, setPage] = useState(Math.min(Math.max(initialPage, 1), pageCount));
  const [offer, setOffer] = useState(offerIn);
  const [box, setBox] = useState({ w: 0, h: 0 }); // the whole reader (Book mode)
  const [size, setSize] = useState({ w: 0, h: 0 }); // the PDF scroll area
  const [scrollTop, setScrollTop] = useState(0);
  const [est, setEst] = useState<number | null>(null); // aspect ratio learned from the first page that loads
  const [ratios, setRatios] = useState<Record<number, number>>({}); // pages that differ from est
  const [editing, setEditing] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState("");
  const [full, setFull] = useState(false);
  const [phase, setPhase] = useState<"in" | "out" | "off">("in"); // opening animation
  const toast = useToast();
  const phoneUi = usePhone(767);
  const bm = useBookmarks(slug, pageCount);
  const [bmOpen, setBmOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const renders = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const book = useRef<BookHandle>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef({ page: 1, delta: 0 });
  const placed = useRef(false);
  const loadFrac = useRef(0);
  const cb = useRef({ onExpired });
  useEffect(() => { cb.current = { onExpired }; });

  const setMode = (m: ReadMode) => {
    setModeState(m);
    if (m === "pdf") placed.current = false; // the scroller is created again: place it on the current page
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };

  const setEffect = (v: PageEffect) => {
    setEffectState(v);
    setFxMenu(false);
    try { localStorage.setItem(EFFECT_KEY, v); } catch { /* ignore */ }
  };
  // render counter (read by the performance tests)
  useLayoutEffect(() => { if (root.current) root.current.dataset.renders = String(++renders.current); });

  // ---- opening: preload + decode the starting page and its neighbours while the animation plays ----
  useEffect(() => {
    const t0 = performance.now();
    const start = Math.min(Math.max(initialPage, 1), pageCount);
    const w = window.innerWidth >= 1024 && window.innerWidth > window.innerHeight;
    let pages: number[];
    if (mode === "book") {
      const total = unitCount(pageCount, w);
      pages = windowUnits(unitOf(start, w), total).flatMap((u) => realPages(u, w, pageCount));
    } else {
      pages = [start, start + 1].filter((n) => n <= pageCount);
    }
    let settled = 0;
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const out = () => {
      if (done) return;
      done = true;
      loadFrac.current = 1;
      setPhase("out");
      timers.push(setTimeout(() => setPhase("off"), reduced ? 300 : 380));
    };
    const work = pages.map((n) =>
      loadPage(slug, n)
        .then((b) => { if (n === start) setEst((e) => e ?? b.height / b.width); })
        .catch((e) => { if (e instanceof Unauthorized) cb.current.onExpired(); })
        .finally(() => { settled++; loadFrac.current = settled / pages.length; }),
    );
    Promise.all(work).then(() => {
      timers.push(setTimeout(out, Math.max(0, (reduced ? 0 : OPEN_MIN_MS) - (performance.now() - t0))));
    });
    timers.push(setTimeout(() => { setEst((e) => e ?? DEFAULT_RATIO); out(); }, OPEN_MAX_MS));
    // the page offered by "Continuar" is warmed quietly so it is ready if chosen
    if (offerIn > 0) timers.push(setTimeout(() => { for (const n of [offerIn, offerIn + 1]) if (n <= pageCount) loadPage(slug, n).catch(() => {}); }, 1200));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- geometry (PDF mode) ----------------------------------------------------------
  const LEAD = PAD; // the toolbar is a normal row above the page area: nothing scrolls under it
  const ratio0 = est ?? DEFAULT_RATIO;
  const availW = Math.max(size.w - 2 * PAD, 120);
  const availH = Math.max(size.h - 2 * PAD, 120);
  const fitW = Math.min(availW, 1040); // comfortable line length on wide screens; zoom in for more
  const W = fit === "width" ? fitW : fit === "page" ? Math.min(fitW, availH / ratio0) : (REF_W * customPct) / 100;
  const pct = Math.round((W / REF_W) * 100);
  const ratioOf = (n: number) => ratios[n] ?? ratio0;

  const offs = (() => {
    const o = new Float64Array(pageCount + 1);
    o[0] = LEAD;
    for (let i = 1; i <= pageCount; i++) o[i] = o[i - 1] + W * ratioOf(i) + GAP;
    return o;
  })();
  const total = offs[pageCount] - GAP + PAD;
  const indexAt = useCallback((y: number, o: Float64Array) => {
    let lo = 0, hi = pageCount - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }, [pageCount]);

  // latest geometry for event handlers
  const geo = useRef({ offs, total, size, lead: LEAD });
  // Layout effect (declared before the placement effects below): handlers must never read geometry from an older render.
  useLayoutEffect(() => { geo.current = { offs, total, size, lead: LEAD }; });

  const estRef = useRef<number | null>(null);
  useEffect(() => { estRef.current = est; });
  const onRatio = useCallback((n: number, r: number) => {
    setEst((e) => (e === null ? r : e));
    const e0 = estRef.current;
    setRatios((m) => (m[n] !== undefined || (e0 !== null && Math.abs(r - e0) / e0 < 0.005) ? m : { ...m, [n]: r }));
  }, []);
  const pdf = mode === "pdf";
  const ready = est !== null && (pdf ? size.w > 0 : box.w > 0);

  // ---- sizes ----
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!pdf || !el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf, ready]);

  // ---- scrolling (PDF mode) ----
  const raf = useRef(0);
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scroller.current;
      if (!el || !pdf) return;
      const g = geo.current;
      const top = el.scrollTop;
      setScrollTop(top);
      const pTop = indexAt(top, g.offs);
      anchor.current = { page: pTop, delta: top - g.offs[pTop - 1] };
      const cur = top + g.size.h >= g.total - 2 ? pageCount : indexAt(top + g.lead + Math.min(0.3 * g.size.h, 120), g.offs);
      setPage(cur);
      if (cur > 1) setOffer(0);
    });
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // These close over THIS render's geometry (offs), so effects that run in the same commit never see stale offsets.
  const scrollToPage = (n: number) => {
    const el = scroller.current;
    if (!el) return;
    anchor.current = { page: n, delta: -LEAD };
    const top = Math.max(0, offs[n - 1] - LEAD);
    el.scrollTop = top;
    setScrollTop(top); // render the window around page n right away, never the pages in between
  };
  const goTo = (n: number) => {
    const c = Math.min(pageCount, Math.max(1, Math.round(n)));
    setPage(c);
    setOffer(0);
    if (pdf) scrollToPage(c);
  };

  // ---- bookmarks: the toggle applies to the current page (the left page of a spread) ----
  const bookmarked = bm.marks.has(page);
  const toggleBookmark = () => {
    if (!bm.ready) return;
    const cur = bm.items.find((i) => i.page === page);
    if (cur) {
      bm.remove(cur.id);
      toast("ok", "Marcador eliminado", { label: "Deshacer", onClick: () => bm.add(cur.page, cur.label) });
      return;
    }
    if (bm.items.length >= LIMIT) { toast("error", `Has alcanzado el límite de ${LIMIT} marcadores en este libro.`); return; }
    const id = bm.add(page);
    if (id) toast("ok", "Marcador añadido", { label: "Deshacer", onClick: () => bm.remove(id) });
  };
  const jumpTo = (n: number) => { goTo(n); if (phoneUi) setBmOpen(false); };

  // first placement once geometry is known
  useLayoutEffect(() => {
    if (!ready || placed.current || !pdf) return;
    placed.current = true;
    scrollToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pdf]);
  // keep the same page in view when zoom / fit / ratios change the layout
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !placed.current || !pdf) return;
    const want = offs[anchor.current.page - 1] + anchor.current.delta;
    if (Math.abs(want - el.scrollTop) > 1) el.scrollTop = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, est, ratios]);
  // ---- URL (#p=N), saved page ----
  useEffect(() => {
    const t = setTimeout(() => {
      // The native method, not Next's patched one: that one re-renders the whole app (and starts a view transition) on every page turn.
      try { History.prototype.replaceState.call(window.history, window.history.state, "", `${window.location.pathname}${window.location.search}#p=${page}`); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [page]);
  useEffect(() => {
    if (offer) return; // never overwrite the saved page before the offer is answered
    try { localStorage.setItem(lsKey, String(page)); } catch { /* ignore */ }
    reportPage(slug, page); // signed-in readers: synced to the account, at most every 20 s
  }, [lsKey, page, offer, slug]);
  useEffect(() => () => flushBook(slug), [slug]);
  useEffect(() => {
    const onHash = () => { const m = /^#p=(\d+)$/.exec(window.location.hash); if (m) goTo(Number(m[1])); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });

  // ---- keyboard + deterrents ----
  const turn = (d: 1 | -1) => (pdf ? goTo(page + d) : book.current?.turn(d));
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["s", "p"].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.getAttribute("role") === "radio")) return;
      if (e.key === "ArrowRight" || (!pdf && e.key === "PageDown")) { e.preventDefault(); turn(1); }
      else if (e.key === "ArrowLeft" || (!pdf && e.key === "PageUp")) { e.preventDefault(); turn(-1); }
      else if (e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleBookmark(); }
      else if (e.key === "Home") { e.preventDefault(); goTo(1); }
      else if (e.key === "End") { e.preventDefault(); goTo(pageCount); }
    };
    document.addEventListener("contextmenu", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("selectstart", stop);
    window.addEventListener("keydown", key);
    const fs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fs);
    return () => {
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("dragstart", stop);
      document.removeEventListener("selectstart", stop);
      window.removeEventListener("keydown", key);
      document.removeEventListener("fullscreenchange", fs);
    };
  });

  // ---- toolbar actions ----
  const zoomTo = (next: number) => { setFit("custom"); setCustomPct(Math.min(400, Math.max(25, next))); };
  const zoomIn = () => zoomTo(STEPS.find((s) => s > pct + 1) ?? 400);
  const zoomOut = () => zoomTo([...STEPS].reverse().find((s) => s < pct - 1) ?? 25);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); };
  const flash = (m: string) => {
    setPageMsg(m);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setPageMsg(""), 3500);
  };
  const submitPage = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = (editing ?? "").trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > pageCount) { flash(`Introduce un número entre 1 y ${pageCount}`); return; }
    setPageMsg("");
    setEditing(null);
    goTo(n);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // ---- which pages exist in the DOM (PDF mode): only those near the viewport ----
  const winFrom = ready && pdf ? indexAt(Math.max(0, scrollTop - 0.75 * size.h), offs) : 0;
  const winTo = ready && pdf ? indexAt(scrollTop + 1.75 * size.h, offs) : -1;
  const innerW = Math.max(size.w, W + 2 * PAD);


  // Zoom (PDF only), fullscreen and theme. Inline from sm up; inside the "more" menu on phones.
  const secondary = (inMenu: boolean) => (
    <>
      {pdf && (
        <>
          <button type="button" className={tb} disabled={pct <= 25} onClick={zoomOut} aria-label="Reducir zoom" title="Reducir zoom"><Icon name="zoomOut" /></button>
          <span className="tnum w-11 text-center text-sm text-glass-muted" aria-live="polite">{pct}%</span>
          <button type="button" className={tb} disabled={pct >= 400} onClick={zoomIn} aria-label="Ampliar zoom" title="Ampliar zoom"><Icon name="zoomIn" /></button>
          <button type="button" className={`${tb} ${fit === "width" ? "bg-fg/10!" : ""}`} aria-pressed={fit === "width"} onClick={() => setFit("width")} aria-label="Ajustar al ancho" title="Ajustar al ancho"><Icon name="fitWidth" /></button>
          <button type="button" className={`${tb} ${fit === "page" ? "bg-fg/10!" : ""}`} aria-pressed={fit === "page"} onClick={() => setFit("page")} aria-label="Ajustar a la página" title="Ajustar a la página"><Icon name="fitPage" /></button>
          {!inMenu && <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />}
        </>
      )}
      {!pdf && (inMenu ? (
        <div role="radiogroup" aria-label="Efecto de página" className="flex w-full items-center gap-1 px-1 py-1">
          <span className="mr-1 text-[13px] text-muted">Efecto</span>
          {EFFECTS.map((f) => (
            <button key={f.v} type="button" role="radio" aria-checked={effect === f.v} onClick={() => setEffect(f.v)} className={`btn btn-sm min-h-11 px-2.5 ${effect === f.v ? "btn-primary" : ""}`}>{f.label}</button>
          ))}
        </div>
      ) : (
        <div className="relative">
          <button type="button" className={`${tb} ${fxMenu ? "bg-fg/10!" : ""}`} aria-haspopup="menu" aria-expanded={fxMenu} onClick={() => setFxMenu((v) => !v)} aria-label="Efecto de página" title="Efecto de página"><Icon name="pages" /></button>
          {fxMenu && (
            <div role="menu" aria-label="Efecto de página" className="absolute right-0 top-full z-40 mt-1 w-44 rounded-card border border-line bg-bg p-1 shadow-[var(--shadow-float)]">
              <p className="px-3 pb-1 pt-2 text-[13px] text-muted">Efecto de página</p>
              {EFFECTS.map((f) => (
                <button key={f.v} type="button" role="menuitemradio" aria-checked={effect === f.v} onClick={() => setEffect(f.v)} className="flex min-h-11 w-full items-center justify-between rounded-ctl px-3 text-left text-[15px] hover:bg-fg/10">
                  {f.label}{effect === f.v && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" className={tb} onClick={toggleFull} aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"} title={full ? "Salir de pantalla completa" : "Pantalla completa"}><Icon name={full ? "shrink" : "expand"} /></button>
      <ThemeToggle className="min-h-11! min-w-11! border-transparent bg-transparent!" />
    </>
  );

  return (
    <div
      ref={root}
      className={`reader-root fixed inset-0 flex flex-col bg-surface text-fg ${reduced && phase !== "in" ? "fade-in" : ""}`}
      data-renders="0"
    >
      {/* The toolbar is always visible: a normal row above the page area (solid, so nothing blurs over a turning page). */}
      <header role="toolbar" aria-label="Barra del lector" className="reader-bar relative z-30 shrink-0 border-b border-line bg-bg py-1">
        <div className="mx-auto flex max-w-[1400px] flex-nowrap items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button type="button" className={tb} onClick={onClose} aria-label="Volver a la ficha del libro" title="Volver a la ficha del libro"><Icon name="back" /></button>
            <h1 className="hidden min-w-0 flex-1 truncate text-nowrap font-serif text-base font-semibold min-[480px]:block">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <ModeSwitch value={mode} onChange={setMode} />
            <form onSubmit={submitPage} className="relative ml-1 flex items-center gap-1.5 text-sm" noValidate>
              <label htmlFor="pagina" className="sr-only">Ir a la página</label>
              <input
                id="pagina" inputMode="numeric" autoComplete="off" enterKeyHint="go" aria-describedby="pagina-msg" aria-invalid={!!pageMsg}
                value={editing ?? String(page)}
                onFocus={(e) => { setEditing(String(page)); e.currentTarget.select(); }}
                onChange={(e) => setEditing(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                onBlur={() => { setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") { setEditing(null); setPageMsg(""); (e.currentTarget as HTMLInputElement).blur(); } }}
                className="field tnum min-h-11 w-12! px-1! py-1! text-center sm:w-14!"
              />
              <span className="tnum whitespace-nowrap text-muted">/ {pageCount}</span>
              <p id="pagina-msg" role="alert" className={`absolute right-0 top-full z-10 mt-1 w-max max-w-[16rem] rounded-ctl border border-danger bg-bg px-2.5 py-1.5 text-[13px] text-danger sm:left-0 sm:right-auto ${pageMsg ? "" : "hidden"}`}>{pageMsg}</p>
            </form>

            <button
              type="button" className={`${tb} ${bookmarked ? "text-accent" : ""}`} disabled={!bm.ready} onClick={toggleBookmark} aria-pressed={bookmarked}
              aria-label={bookmarked ? "Quitar marcador" : "Añadir marcador"} title={`${bookmarked ? "Quitar marcador" : "Añadir marcador"} (B)`} data-testid="bookmark-toggle"
            ><Icon name="bookmark" filled={bookmarked} /></button>
            <button
              type="button" className={`${tb} ${bmOpen ? "bg-fg/10!" : ""}`} onClick={() => setBmOpen((v) => !v)} aria-expanded={bmOpen} aria-label="Marcadores" title="Marcadores" data-testid="bookmarks-open"
            ><Icon name="bookmarks" /></button>

            <div className="hidden items-center gap-0.5 sm:flex">
              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
              {secondary(false)}
            </div>
            <button type="button" className={`${tb} sm:hidden ${menu ? "bg-fg/10!" : ""}`} aria-label="Más opciones" title="Más opciones" aria-expanded={menu} aria-controls="lector-menu" onClick={() => setMenu((m) => !m)}><Icon name="more" /></button>
          </div>
        </div>
        {menu && (
          <div id="lector-menu" className="absolute right-2 top-full z-30 mt-1 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-card border border-line bg-bg p-1 shadow-[var(--shadow-float)] sm:hidden">
            {secondary(true)}
          </div>
        )}
      </header>

      <div ref={area} className="relative min-h-0 flex-1">
        {ready && pdf && (
          <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-auto overscroll-contain">
            <div className="relative mx-auto" style={{ height: total, width: innerW }}>
              {Array.from({ length: Math.max(0, winTo - winFrom + 1) }, (_, i) => winFrom + i).map((n) => (
                <div key={n} className="absolute" style={{ top: offs[n - 1], left: (innerW - W) / 2 }}>
                  <PageCanvas slug={slug} n={n} width={W} height={W * ratioOf(n)} delay={90} onRatio={onRatio} onExpired={onExpired} marked={bm.marks.has(n)} />
                </div>
              ))}
            </div>
          </div>
        )}
        {!ready && pdf && <div ref={scroller} className="absolute inset-0 grid place-items-center"><div className="skeleton h-48 w-36 rounded-card" aria-label="Cargando" /></div>}
        {ready && !pdf && (
          <BookMode
            ref={book} slug={slug} pageCount={pageCount} page={page} ratio={ratio0} box={box} effect={effect} marks={bm.marks}
            onPage={(n) => { setPage(n); setOffer(0); }}
            onExpired={onExpired}
          />
        )}

        {bmOpen && !phoneUi && (
          <aside aria-label="Marcadores" className="fade-in absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-line bg-bg shadow-[var(--shadow-float)]" data-testid="bookmarks-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <h2 className="font-serif text-xl font-semibold">Marcadores</h2>
              <button type="button" className={tb} onClick={() => setBmOpen(false)} aria-label="Cerrar marcadores"><Icon name="close" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto"><BookmarksPanel slug={slug} items={bm.items} current={page} onJump={jumpTo} onRename={bm.rename} onDelete={bm.remove} /></div>
          </aside>
        )}

        {offer > 0 && ready && (
          <div className="fade-in absolute inset-x-0 z-30 mx-auto flex w-[min(92vw,28rem)] flex-wrap items-center justify-center gap-2 rounded-card border border-line bg-bg p-3 shadow-[var(--shadow-float)]" style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
            <button className="btn btn-primary" onClick={() => goTo(offer)}>Continuar en la página {offer}</button>
            <button className="btn" onClick={() => setOffer(0)}>Empezar desde el principio</button>
          </div>
        )}
      </div>

      <Sheet open={bmOpen && phoneUi} onClose={() => setBmOpen(false)} label="Marcadores">
        <h2 className="mb-2 font-serif text-2xl font-semibold">Marcadores</h2>
        <div className="max-h-[60vh] overflow-auto"><BookmarksPanel slug={slug} items={bm.items} current={page} onJump={jumpTo} onRename={bm.rename} onDelete={bm.remove} /></div>
      </Sheet>

      {phase !== "off" && <OpeningBook slug={slug} title={title} progress={loadFrac} out={phase === "out"} reduced={reduced} />}
    </div>
  );
}
