"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { loadPage, prefetch } from "@/lib/client/pages";
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
type Mode = "continuous" | "single";
type Fit = "width" | "page" | "custom";

const REF_W = 794; // 100% = an A4 page at 96 dpi
const STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const PAD = 16;
const GAP = 12;
const DEFAULT_RATIO = 1.4142;
const tb = "btn btn-icon min-h-9! min-w-9! border-transparent sm:min-h-10! sm:min-w-10!";

export default function Viewer({ slug, title, pageCount, initialPage, offer: offerIn, onClose, onExpired }: Props) {
  const lsKey = `br:last:${slug}`;
  const [mode, setMode] = useState<Mode>("single"); // book-style (one page + next/prev buttons) is the default
  const [fit, setFit] = useState<Fit>("page");
  const [menu, setMenu] = useState(false); // phones: secondary controls live in a menu so the toolbar stays on one line
  const [customPct, setCustomPct] = useState(100);
  const [page, setPage] = useState(Math.min(Math.max(initialPage, 1), pageCount));
  const [offer, setOffer] = useState(offerIn);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [est, setEst] = useState<number | null>(null); // aspect ratio learned from the first page that loads
  const [ratios, setRatios] = useState<Record<number, number>>({}); // pages that differ from est
  const [editing, setEditing] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState("");
  const [full, setFull] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<number | null>(null);
  const anchor = useRef({ page: 1, delta: 0 });
  const placed = useRef(false);

  // ---- geometry ----------------------------------------------------------
  const ratio0 = est ?? DEFAULT_RATIO;
  const availW = Math.max(size.w - 2 * PAD, 120);
  const availH = Math.max(size.h - 2 * PAD, 120);
  const fitW = Math.min(availW, 1040); // comfortable line length on wide screens; zoom in for more
  const W = fit === "width" ? fitW : fit === "page" ? Math.min(fitW, availH / ratio0) : (REF_W * customPct) / 100;
  const pct = Math.round((W / REF_W) * 100);
  const ratioOf = (n: number) => ratios[n] ?? ratio0;

  const offs = (() => {
    const o = new Float64Array(pageCount + 1);
    o[0] = PAD;
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
  const geo = useRef({ offs, total, size });
  // Layout effect (declared before the placement effects below): handlers must never read geometry from an older render.
  useLayoutEffect(() => { geo.current = { offs, total, size }; });

  // ---- learn the page ratio; before a far-away first page is shown, fetch just THAT page ----
  const estRef = useRef<number | null>(null);
  useEffect(() => { estRef.current = est; });
  const onRatio = useCallback((n: number, r: number) => {
    setEst((e) => (e === null ? r : e));
    const e0 = estRef.current;
    setRatios((m) => (m[n] !== undefined || (e0 !== null && Math.abs(r - e0) / e0 < 0.005) ? m : { ...m, [n]: r }));
  }, []);
  useEffect(() => {
    if (initialPage <= 1 || est !== null) return;
    let dead = false;
    loadPage(slug, Math.min(initialPage, pageCount)).then((b) => { if (!dead) setEst(b.height / b.width); }).catch(() => { if (!dead) setEst(DEFAULT_RATIO); });
    return () => { dead = true; };
  }, [slug, initialPage, pageCount, est]);
  const ready = size.w > 0 && (initialPage <= 1 || est !== null);

  // ---- size of the scroll area ----
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- scrolling ----
  const raf = useRef(0);
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scroller.current;
      if (!el || mode !== "continuous") return;
      const g = geo.current;
      const top = el.scrollTop;
      setScrollTop(top);
      const pTop = indexAt(top, g.offs);
      anchor.current = { page: pTop, delta: top - g.offs[pTop - 1] };
      const cur = top + g.size.h >= g.total - 2 ? pageCount : indexAt(top + Math.min(0.3 * g.size.h, 120), g.offs);
      setPage(cur);
      if (cur > 1) setOffer(0);
    });
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // These close over THIS render's geometry (offs), so effects that run in the same commit never see stale offsets.
  const scrollToPage = (n: number) => {
    const el = scroller.current;
    if (!el) return;
    anchor.current = { page: n, delta: -PAD };
    const top = Math.max(0, offs[n - 1] - PAD);
    el.scrollTop = top;
    setScrollTop(top); // render the window around page n right away, never the pages in between
  };
  const goTo = (n: number) => {
    const c = Math.min(pageCount, Math.max(1, Math.round(n)));
    setPage(c);
    setOffer(0);
    if (mode === "continuous") scrollToPage(c);
    else scroller.current?.scrollTo({ top: 0 });
  };

  // first placement once geometry is known
  useLayoutEffect(() => {
    if (!ready || placed.current) return;
    placed.current = true;
    if (page > 1) scrollToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // keep the same page in view when zoom / fit / ratios change the layout
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !placed.current || mode !== "continuous") return;
    const want = offs[anchor.current.page - 1] + anchor.current.delta;
    if (Math.abs(want - el.scrollTop) > 1) el.scrollTop = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, est, ratios]);
  // switching back to continuous mode: land on the current page
  const prevMode = useRef(mode);
  useLayoutEffect(() => {
    if (prevMode.current !== mode && mode === "continuous") scrollToPage(page);
    prevMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- URL (#p=N), saved page ----
  useEffect(() => {
    const t = setTimeout(() => {
      try { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#p=${page}`); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [page]);
  useEffect(() => {
    if (offer) return; // never overwrite the saved page before the offer is answered
    try { localStorage.setItem(lsKey, String(page)); } catch { /* ignore */ }
  }, [lsKey, page, offer]);
  useEffect(() => {
    const onHash = () => { const m = /^#p=(\d+)$/.exec(window.location.hash); if (m) goTo(Number(m[1])); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });

  // single-page mode: warm only the next 2 pages
  useEffect(() => {
    if (mode === "single") prefetch(slug, [page + 1, page + 2], pageCount);
  }, [mode, page, slug, pageCount]);

  // ---- keyboard + deterrents ----
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["s", "p"].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || (mode === "single" && e.key === "PageDown")) { e.preventDefault(); goTo(page + 1); }
      else if (e.key === "ArrowLeft" || (mode === "single" && e.key === "PageUp")) { e.preventDefault(); goTo(page - 1); }
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

  // ---- which pages exist in the DOM: only those near the viewport ----
  const winFrom = ready && mode === "continuous" ? indexAt(Math.max(0, scrollTop - 0.75 * size.h), offs) : 0;
  const winTo = ready && mode === "continuous" ? indexAt(scrollTop + 1.75 * size.h, offs) : -1;
  const innerW = Math.max(size.w, W + 2 * PAD);

  // Zoom, fit, mode, fullscreen and theme. Inline from sm up; inside the "more" menu on phones.
  const secondary = (inMenu: boolean) => (
    <>
      <button type="button" className={tb} disabled={pct <= 25} onClick={zoomOut} aria-label="Reducir zoom" title="Reducir zoom"><Icon name="zoomOut" /></button>
      <span className="tnum w-11 text-center text-sm text-muted" aria-live="polite">{pct}%</span>
      <button type="button" className={tb} disabled={pct >= 400} onClick={zoomIn} aria-label="Ampliar zoom" title="Ampliar zoom"><Icon name="zoomIn" /></button>
      <button type="button" className={`${tb} ${fit === "width" ? "bg-surface!" : ""}`} aria-pressed={fit === "width"} onClick={() => setFit("width")} aria-label="Ajustar al ancho" title="Ajustar al ancho"><Icon name="fitWidth" /></button>
      <button type="button" className={`${tb} ${fit === "page" ? "bg-surface!" : ""}`} aria-pressed={fit === "page"} onClick={() => setFit("page")} aria-label="Ajustar a la página" title="Ajustar a la página"><Icon name="fitPage" /></button>
      {!inMenu && <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />}
      <button type="button" className={tb} onClick={toggleFull} aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"} title={full ? "Salir de pantalla completa" : "Pantalla completa"}><Icon name={full ? "shrink" : "expand"} /></button>
      <ThemeToggle className="border-transparent min-h-9! min-w-9! sm:min-h-10! sm:min-w-10!" />
    </>
  );

  return (
    <div className="reader-root fixed inset-0 flex flex-col bg-surface text-fg">
      <header role="toolbar" aria-label="Barra del lector" className="relative border-b border-line bg-bg px-2 py-1">
        <div className="mx-auto flex max-w-[1400px] flex-nowrap items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button type="button" className={tb} onClick={onClose} aria-label="Volver a la ficha del libro" title="Volver a la ficha del libro"><Icon name="back" /></button>
            <h1 className="min-w-0 flex-1 truncate text-nowrap font-serif text-base font-semibold">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" className={`${tb} ${mode === "continuous" ? "" : "bg-surface!"}`} aria-pressed={mode === "single"} onClick={() => { const m = mode === "continuous" ? "single" : "continuous"; setMode(m); setFit(m === "single" ? "page" : "width"); }} aria-label={mode === "continuous" ? "Modo libro: una página cada vez" : "Modo PDF: desplazamiento continuo"} title={mode === "continuous" ? "Modo libro (una página cada vez)" : "Modo PDF (desplazamiento continuo)"}>
              <Icon name={mode === "continuous" ? "single" : "continuous"} />
            </button>
            {mode === "single" && <button type="button" className={tb} disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label="Página anterior" title="Página anterior"><Icon name="back" /></button>}
            <form onSubmit={submitPage} className="relative flex items-center gap-1.5 text-sm" noValidate>
              <label htmlFor="pagina" className="sr-only">Ir a la página</label>
              <input
                id="pagina" inputMode="numeric" autoComplete="off" enterKeyHint="go" aria-describedby="pagina-msg" aria-invalid={!!pageMsg}
                value={editing ?? String(page)}
                onFocus={(e) => { setEditing(String(page)); e.currentTarget.select(); }}
                onChange={(e) => setEditing(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                onBlur={() => { setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") { setEditing(null); setPageMsg(""); (e.currentTarget as HTMLInputElement).blur(); } }}
                className="field tnum w-12! px-1! py-1! text-center sm:w-14!"
              />
              <span className="tnum whitespace-nowrap text-muted">/ {pageCount}</span>
              <p id="pagina-msg" role="alert" className={`absolute right-0 top-full z-10 mt-1 w-max max-w-[16rem] rounded-ctl border border-danger bg-bg px-2.5 py-1.5 text-[13px] text-danger sm:left-0 sm:right-auto ${pageMsg ? "" : "hidden"}`}>{pageMsg}</p>
            </form>
            {mode === "single" && <button type="button" className={tb} disabled={page >= pageCount} onClick={() => goTo(page + 1)} aria-label="Página siguiente" title="Página siguiente"><Icon name="next" /></button>}

            <div className="hidden items-center gap-0.5 sm:flex">
              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
              {secondary(false)}
            </div>
            <button type="button" className={`${tb} sm:hidden ${menu ? "bg-surface!" : ""}`} aria-label="Más opciones" title="Más opciones" aria-expanded={menu} aria-controls="lector-menu" onClick={() => setMenu((m) => !m)}><Icon name="more" /></button>
          </div>
        </div>
        {menu && (
          <div id="lector-menu" className="absolute right-2 top-full z-30 mt-1 flex flex-wrap items-center gap-0.5 rounded-card border border-line-strong bg-bg p-1 sm:hidden">
            {secondary(true)}
          </div>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-auto"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (mode !== "single" || touch.current === null || W > size.w) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 60) goTo(page + (dx < 0 ? 1 : -1));
        }}
      >
        {!ready ? (
          <div className="grid h-full place-items-center"><div className="skeleton h-48 w-36 rounded-card" aria-label="Cargando" /></div>
        ) : mode === "continuous" ? (
          <div className="relative mx-auto" style={{ height: total, width: innerW }}>
            {Array.from({ length: Math.max(0, winTo - winFrom + 1) }, (_, i) => winFrom + i).map((n) => (
              <div key={n} className="absolute" style={{ top: offs[n - 1], left: (innerW - W) / 2 }}>
                <PageCanvas slug={slug} n={n} width={W} height={W * ratioOf(n)} delay={90} onRatio={onRatio} onExpired={onExpired} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto p-4" style={{ width: Math.max(innerW, W + 2 * PAD) }}>
            <div className="mx-auto" style={{ width: W }}>
              <PageCanvas key={page} slug={slug} n={page} width={W} height={W * ratioOf(page)} onRatio={onRatio} onExpired={onExpired} />
            </div>
          </div>
        )}
      </div>

      {/* Side navigation: always-visible previous / next page buttons */}
      {ready && mode === "single" && (
        <>
          <button
            type="button" disabled={page <= 1} onClick={() => goTo(page - 1)}
            aria-label="Página anterior" title="Página anterior"
            className="btn btn-icon absolute left-2 top-[calc(50%+1.5rem)] z-20 -translate-y-1/2 rounded-full border-line-strong bg-bg/90 shadow-sm backdrop-blur disabled:hidden sm:left-4"
          ><Icon name="back" size={24} /></button>
          <button
            type="button" disabled={page >= pageCount} onClick={() => goTo(page + 1)}
            aria-label="Página siguiente" title="Página siguiente"
            className="btn btn-icon absolute right-4 top-[calc(50%+1.5rem)] z-20 -translate-y-1/2 rounded-full border-line-strong bg-bg/90 shadow-sm backdrop-blur disabled:hidden sm:right-6"
          ><Icon name="next" size={24} /></button>
        </>
      )}

      {offer > 0 && (
        <div className="fade-in absolute inset-x-0 bottom-4 z-30 mx-auto flex w-[min(92vw,28rem)] flex-wrap items-center justify-center gap-2 rounded-card border border-line-strong bg-bg p-3 shadow-sm">
          <button className="btn btn-primary" onClick={() => goTo(offer)}>Continuar en la página {offer}</button>
          <button className="btn" onClick={() => setOffer(0)}>Empezar desde el principio</button>
        </div>
      )}
    </div>
  );
}
