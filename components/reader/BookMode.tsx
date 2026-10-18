"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { getFace, prepareFace, trimFaces } from "@/lib/client/faces";
import { loadPage, peekPage, trimPages, Unauthorized } from "@/lib/client/pages";
import { pageOfUnit, pagesOfUnit, realPages, unitCount, unitOf, windowUnits } from "@/lib/client/spreads";

export interface BookHandle { turn(dir: 1 | -1): void }
interface Props {
  slug: string;
  pageCount: number;
  /** Current page (shared with PDF mode). */
  page: number;
  /** height / width of a page */
  ratio: number;
  box: { w: number; h: number };
  reduced: boolean;
  onPage: (n: number) => void;
  /** Tap on the middle of the page (show / hide the toolbar). */
  onTap: () => void;
  /** The reader started turning pages (the toolbar can get out of the way). */
  onTurnStart: () => void;
  onExpired: () => void;
}

interface Turn { dir: 1 | -1; from: number; to: number; wide: boolean }
type Run = { target: 0 | 1; v0: number; kind: "tween" | "spring"; fast: boolean };

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const KEEP_DISTANCE = 3; // decoded pages further than this many units away are dropped
const TWEEN_MS = 450;
const ANGLE_SINGLE = 100;

/**
 * One page: its canvas (never an <img>), kept by lib/client/faces and moved in here, or a shimmering skeleton.
 * Faces are drawn when idle, so turning a page only moves nodes and animates transform / opacity.
 */
function PageFace({ slug, n, w, h, version, failed }: { slug: string; n: number; w: number; h: number; version: number; failed: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const c = getFace(slug, n, w, h);
    if (!c) return;
    if (c.parentElement !== el) el.appendChild(c);
    el.dataset.ready = "1";
  }, [slug, n, w, h, version]);
  return (
    <div ref={wrap} className="page-face page-skeleton absolute inset-0 overflow-hidden" data-page={n}>
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted">No se ha podido cargar esta página.</p>}
    </div>
  );
}

function Shade({ r, side, dark = 0.38 }: { r: React.Ref<HTMLDivElement>; side: "left" | "right"; dark?: number }) {
  return <div ref={r} className="pointer-events-none absolute inset-0" style={{ opacity: 0, willChange: "opacity", background: `linear-gradient(to ${side === "left" ? "right" : "left"}, rgba(0,0,0,${dark}), rgba(0,0,0,0) 55%)` }} />;
}

const BookMode = forwardRef<BookHandle, Props>(function BookMode(
  { slug, pageCount, page, ratio, box, reduced, onPage, onTap, onTurnStart, onExpired },
  handle,
) {
  const wide = box.w >= 1024 && box.w > box.h;
  const total = unitCount(pageCount, wide);
  const [unit, setUnit] = useState(() => clamp(unitOf(page, wide), 0, total - 1));
  const [turn, setTurn] = useState<Turn | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const markFailed = useCallback((n: number, bad: boolean) => setFailed((f) => (f.has(n) === bad ? f : (() => { const x = new Set(f); if (bad) x.add(n); else x.delete(n); return x; })())), []);

  const unitRef = useRef(unit);
  const busy = useRef(false);
  const queue = useRef(0);
  const pRef = useRef(0);
  const turnRef = useRef<Turn | null>(null);
  const run = useRef<Run | null>(null);
  const raf = useRef(0);
  const anims = useRef<Animation[]>([]);
  const jumpToken = useRef(0);
  const again = useRef<(d: 1 | -1) => void>(() => {});
  const cb = useRef({ onPage, onTap, onTurnStart, onExpired });
  useEffect(() => { cb.current = { onPage, onTap, onTurnStart, onExpired }; });
  useEffect(() => { unitRef.current = unit; }, [unit]);

  // ---- geometry ----
  const pad = 12;
  const pw = Math.max(80, Math.floor(Math.min(wide ? box.w / 2 - pad : box.w - 2 * pad, (box.h - 2 * pad) / ratio)));
  const ph = Math.round(pw * ratio);
  const sw = wide ? pw * 2 : pw;

  // ---- preloading: current + next 2 + previous 1 (spread-aware), fetched AND decoded ----
  const bump = useRef(0);
  const touchVersion = useCallback(() => {
    if (bump.current) return;
    bump.current = requestAnimationFrame(() => { bump.current = 0; setVersion((v) => v + 1); });
  }, []);
  const ensure = useCallback((pages: number[]) =>
    Promise.all(pages.map((n) =>
      loadPage(slug, n).then(() => { markFailed(n, false); touchVersion(); }, (e) => {
        if (e instanceof Unauthorized) cb.current.onExpired();
        else markFailed(n, true);
        throw e;
      }),
    )), [slug, touchVersion, markFailed]);
  useEffect(() => {
    const near = (n: number) => Math.abs(unitOf(n, wide) - unit) <= KEEP_DISTANCE;
    for (const u of windowUnits(unit, total)) {
      const pages = realPages(u, wide, pageCount);
      ensure(pages).then(() => { for (const n of pages) prepareFace(slug, n, pw, ph); }, () => {});
    }
    trimPages(slug, near);
    trimFaces(slug, near, pw, ph);
  }, [unit, total, wide, pageCount, slug, ensure, pw, ph]);
  useEffect(() => () => { if (bump.current) cancelAnimationFrame(bump.current); }, []);

  const isReady = useCallback((u: number) => realPages(u, wide, pageCount).every((n) => !!peekPage(slug, n)), [slug, wide, pageCount]);

  // ---- imperative animation of the turning leaf: transform + opacity only ----
  const leaf = useRef<HTMLDivElement>(null);
  const frontShade = useRef<HTMLDivElement>(null);
  const backShade = useRef<HTMLDivElement>(null);
  const destShade = useRef<HTMLDivElement>(null);
  const otherShade = useRef<HTMLDivElement>(null);
  /** The inline styles of every moving part at progress p (pure, so the same numbers drive JS frames and keyframes). */
  const stylesAt = useCallback((t: Turn, p: number) => {
    if (t.wide) {
      return {
        leaf: { transform: `rotateY(${(t.dir === 1 ? -180 : 180) * p}deg)` } as Record<string, string>,
        front: { opacity: String(0.4 * clamp(p * 2)) },
        back: { opacity: String(0.4 * clamp((1 - p) * 2)) },
        dest: { opacity: String((1 - p) * Math.min(1, p * 10)) },
        other: { opacity: String(p > 0.5 ? Math.sin(Math.PI * p) : 0) },
      };
    }
    const q = t.dir === 1 ? p : 1 - p; // how far the leaf is lifted: 0 flat, 1 gone
    return {
      leaf: { transform: `rotateY(${-ANGLE_SINGLE * q}deg)`, opacity: String(q > 0.8 ? clamp((1 - q) / 0.2) : 1) } as Record<string, string>,
      front: { opacity: String(0.4 * clamp(q * 1.5)) },
      back: null,
      dest: { opacity: String(Math.sin(Math.PI * q) * 0.9) },
      other: null,
    };
  }, []);
  const parts = useCallback(() => ([
    ["leaf", leaf.current], ["front", frontShade.current], ["back", backShade.current], ["dest", destShade.current], ["other", otherShade.current],
  ] as const), []);
  const apply = useCallback((p: number) => {
    const t = turnRef.current;
    if (!t || !leaf.current) return;
    const st = stylesAt(t, p);
    for (const [k, el] of parts()) {
      const v = st[k];
      if (el && v) Object.assign(el.style, v);
    }
  }, [stylesAt, parts]);

  const finish = useCallback((committed: boolean) => {
    const t = turnRef.current;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    apply(committed ? 1 : 0);
    for (const a of anims.current) a.cancel(); // inline styles already hold the final values
    anims.current = [];
    turnRef.current = null;
    busy.current = false;
    if (committed && t) {
      unitRef.current = t.to;
      setUnit(t.to);
      cb.current.onPage(pageOfUnit(t.to, t.wide));
      cb.current.onTurnStart(); // the toolbar gets out of the way once the page has turned (never during the animation)
    }
    setTurn(null);
    if (queue.current !== 0) {
      const d = queue.current > 0 ? 1 : -1;
      queue.current -= d;
      setTimeout(() => again.current(d), 0);
    }
  }, [apply]);

  /** Progress samples every ~16 ms for a tween or a spring, ending exactly on the target. */
  const simulate = useCallback((r: Run, from: number) => {
    const out = [from];
    const H = 1 / 60;
    if (r.kind === "tween") {
      const dur = ((r.fast ? 0.55 : 1) * TWEEN_MS * Math.max(0.35, Math.abs(r.target - from))) / 1000;
      const n = Math.max(2, Math.round(dur / H));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        out.push(from + (r.target - from) * e);
      }
      return out;
    }
    // spring (mass 1, stiffness 230, damping ~0.9 of critical), integrated in small steps
    const K = 230, C = 27;
    let x = from, v = r.v0;
    for (let i = 0; i < 54; i++) {
      for (let j = 0; j < 4; j++) { v += (-K * (x - r.target) - C * v) * (H / 4); x += v * (H / 4); }
      x = clamp(x);
      out.push(x);
      if (Math.abs(x - r.target) < 0.002 && Math.abs(v) < 0.05) break;
    }
    out[out.length - 1] = r.target;
    return out;
  }, []);

  const animate = useCallback((r: Run) => {
    cancelAnimationFrame(raf.current);
    for (const a of anims.current) a.cancel();
    anims.current = [];
    const t = turnRef.current;
    const from = pRef.current;
    const samples = simulate(r, from);
    // Compositor-driven: transform and opacity keyframes via the Web Animations API, so the turn keeps its
    // frame rate even when the main thread is busy. Fallback below: one JS style write per frame.
    if (t && leaf.current && typeof leaf.current.animate === "function") {
      const n = samples.length;
      const sts = samples.map((p) => stylesAt(t, p));
      const list: Animation[] = [];
      for (const [k, el] of parts()) {
        if (!el || !sts[0][k]) continue;
        const frames = sts.map((s, i) => ({ ...(s[k] as Record<string, string>), offset: n === 1 ? 1 : i / (n - 1) }));
        list.push(el.animate(frames, { duration: Math.max(16, (n - 1) * (1000 / 60)), easing: "linear", fill: "forwards" }));
      }
      anims.current = list;
      pRef.current = r.target;
      Promise.all(list.map((a) => a.finished)).then(() => finish(r.target === 1), () => { /* cancelled */ });
      return;
    }
    let i = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      i = Math.min(samples.length - 1, Math.floor((now - t0) / (1000 / 60)));
      pRef.current = samples[i];
      apply(samples[i]);
      if (i >= samples.length - 1) return finish(r.target === 1);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [apply, finish, parts, simulate, stylesAt]);

  // Turn layers have just been rendered: put them at the current progress, then start any queued animation.
  useLayoutEffect(() => {
    if (!turn) return;
    apply(pRef.current);
    const r = run.current;
    if (r) { run.current = null; animate(r); }
  }, [turn, apply, animate]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const begin = useCallback((dir: 1 | -1, r: Run | null) => {
    const from = unitRef.current;
    const to = from + dir;
    pRef.current = 0;
    const t: Turn = { dir, from, to, wide };
    turnRef.current = t;
    run.current = r;
    busy.current = true;
    setTurn(t);
  }, [wide]);

  /** Turn one unit. Starts only when the destination is already decoded; otherwise waits for it (with a skeleton, never blank). */
  const requestTurn = useCallback((dir: 1 | -1) => {
    if (busy.current) { queue.current += dir; return; }
    const from = unitRef.current;
    const to = from + dir;
    if (to < 0 || to >= total) return;
    const go = () => {
      if (reduced) {
        unitRef.current = to;
        setUnit(to);
        setFadeKey((k) => k + 1);
        busy.current = false;
        cb.current.onTurnStart();
        cb.current.onPage(pageOfUnit(to, wide));
        return;
      }
      begin(dir, { target: 1, v0: 0, kind: "tween", fast: queue.current > 0 });
    };
    busy.current = true; // reserved while we wait for the destination
    if (isReady(to)) { go(); return; }
    setPending(true);
    ensure(realPages(to, wide, pageCount)).then(() => { setPending(false); go(); }, () => { setPending(false); busy.current = false; });
  }, [total, reduced, wide, pageCount, isReady, ensure, begin]);

  useEffect(() => { again.current = requestTurn; });
  useImperativeHandle(handle, () => ({ turn: requestTurn }), [requestTurn]);

  // ---- the page changed from outside (page box, #p=, mode switch, rotation): jump, no turn animation ----
  useEffect(() => {
    if (turnRef.current || busy.current) return;
    const u = clamp(unitOf(page, wide), 0, total - 1);
    if (u === unitRef.current) return;
    const token = ++jumpToken.current;
    const swap = () => {
      if (token !== jumpToken.current) return;
      unitRef.current = u;
      setUnit(u);
      setFadeKey((k) => k + 1);
    };
    if (isReady(u)) { swap(); return; }
    setPending(true);
    const timeout = setTimeout(() => { setPending(false); swap(); }, 2500); // after that, skeletons
    ensure(realPages(u, wide, pageCount)).then(() => { clearTimeout(timeout); setPending(false); swap(); }, () => {});
    return () => clearTimeout(timeout);
  }, [page, wide, total, pageCount, isReady, ensure]);
  // keep the shared page right when a rotation changes how pages group
  useEffect(() => {
    if (turnRef.current) return;
    const u = clamp(unitOf(page, wide), 0, total - 1);
    if (u === unit) cb.current.onPage(pageOfUnit(u, wide));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  // ---- gestures: drag follows the finger; tap on the edges turns; tap in the middle toggles the toolbar ----
  const g = useRef<{ id: number; x0: number; y0: number; t0: number; dir: 0 | 1 | -1; hist: { t: number; p: number }[]; moved: boolean } | null>(null);
  const range = wide ? pw * 1.5 : pw * 0.95;
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || g.current) return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), dir: 0, hist: [], moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.dir) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 12 || Math.abs(dx) > 12) s.moved = true; return; }
      s.moved = true;
      if (reduced || busy.current) return;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const to = unitRef.current + dir;
      if (to < 0 || to >= total) return;
      if (!isReady(to)) { ensure(realPages(to, wide, pageCount)).catch(() => {}); return; } // never start on a page that is not decoded yet
      s.dir = dir;
      begin(dir, null);
    }
    const p = clamp(((s.dir === 1 ? -dx : dx)) / range);
    pRef.current = p;
    s.hist.push({ t: performance.now(), p });
    if (s.hist.length > 6) s.hist.shift();
    apply(p);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.dir) {
      const h = s.hist;
      let v = 0; // progress per second over the last ~100 ms
      if (h.length >= 2) {
        const a = h.find((q) => h[h.length - 1].t - q.t <= 100) ?? h[0];
        const b = h[h.length - 1];
        v = b.t > a.t ? ((b.p - a.p) / (b.t - a.t)) * 1000 : 0;
      }
      const commit = v > 0.9 ? true : v < -0.9 ? false : pRef.current > 0.5;
      animate({ target: commit ? 1 : 0, v0: v, kind: "spring", fast: false });
      return;
    }
    if (s.moved || performance.now() - s.t0 > 600) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    if (rel < 0.25) requestTurn(-1);
    else if (rel > 0.75) requestTurn(1);
    else cb.current.onTap();
  };
  const onCancel = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.dir) animate({ target: 0, v0: 0, kind: "spring", fast: false });
  };

  // ---- what to render ----
  const [cl, cr] = pagesOfUnit(unit, wide, pageCount);
  const face = (n: number | null) => (n === null ? null : <PageFace key={n} slug={slug} n={n} w={pw} h={ph} version={version} failed={failed.has(n)} />);
  const slotCls = "absolute top-0 overflow-hidden bg-white outline outline-1 -outline-offset-1 outline-line";

  let body: React.ReactNode;
  if (!turn) {
    body = wide ? (
      <>
        {cl !== null && <div className={slotCls} style={{ left: 0, width: pw, height: ph }}>{face(cl)}</div>}
        {cr !== null && <div className={slotCls} style={{ left: pw, width: pw, height: ph }}>{face(cr)}</div>}
      </>
    ) : (
      cr !== null && <div className={slotCls} style={{ left: 0, width: pw, height: ph }}>{face(cr)}</div>
    );
  } else if (turn.wide) {
    const [fl, fr] = pagesOfUnit(turn.from, true, pageCount);
    const [tl, tr] = pagesOfUnit(turn.to, true, pageCount);
    const fwd = turn.dir === 1;
    // base pages: the half the leaf does NOT cover stays; the half it reveals shows the destination
    const leftBase = fwd ? fl : tl;
    const rightBase = fwd ? tr : fr;
    const front = fwd ? fr : fl;
    const back = fwd ? tl : tr;
    body = (
      <>
        <div className={slotCls} style={{ left: 0, width: pw, height: ph, visibility: leftBase === null ? "hidden" : "visible" }}>
          {face(leftBase)}
          <Shade r={fwd ? otherShade : destShade} side={"right"} />
        </div>
        <div className={slotCls} style={{ left: pw, width: pw, height: ph, visibility: rightBase === null ? "hidden" : "visible" }}>
          {face(rightBase)}
          <Shade r={fwd ? destShade : otherShade} side={"left"} />
        </div>
        <div
          ref={leaf}
          className="book-leaf absolute top-0"
          style={{ left: fwd ? pw : 0, width: pw, height: ph, transformOrigin: fwd ? "left center" : "right center", transformStyle: "preserve-3d" }}
        >
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, visibility: front === null ? "hidden" : "visible" }}>
            {face(front)}
            <Shade r={frontShade} side={fwd ? "right" : "left"} dark={0.45} />
          </div>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, transform: "rotateY(180deg)", visibility: back === null ? "hidden" : "visible" }}>
            {face(back)}
            <Shade r={backShade} side={fwd ? "left" : "right"} dark={0.45} />
          </div>
        </div>
      </>
    );
  } else {
    const [, fr] = pagesOfUnit(turn.from, false, pageCount);
    const [, tr] = pagesOfUnit(turn.to, false, pageCount);
    const fwd = turn.dir === 1;
    const baseN = fwd ? tr : fr; // forward: the next page lies underneath; backward: the current one does
    const leafN = fwd ? fr : tr; // forward: the current page lifts; backward: the previous page comes down
    body = (
      <>
        <div className={slotCls} style={{ left: 0, width: pw, height: ph }}>
          {face(baseN)}
          <Shade r={destShade} side={"left"} />
        </div>
        <div ref={leaf} className="book-leaf absolute top-0" style={{ left: 0, width: pw, height: ph, transformOrigin: "left center" }}>
          <div className={`${slotCls} book-face`} style={{ left: 0, width: pw, height: ph }}>
            {face(leafN)}
            <Shade r={frontShade} side={"left"} dark={0.45} />
          </div>
        </div>
      </>
    );
  }

  const cur = pageOfUnit(unit, wide);
  return (
    <div
      className="absolute inset-0 touch-none overflow-hidden"
      style={{ overscrollBehavior: "none" }}
      role="group"
      aria-roledescription="libro"
      aria-label="Libro"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      <div
        key={fadeKey}
        className={`absolute left-1/2 top-1/2 ${fadeKey ? "fade-in" : ""}`}
        style={{ width: sw, height: ph, marginLeft: -sw / 2, marginTop: -ph / 2, perspective: Math.max(sw * 2.2, 1400), perspectiveOrigin: "50% 50%" }}
        data-unit={unit}
        data-wide={wide ? "1" : "0"}
      >
        {body}
      </div>
      {pending && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 mx-auto h-1 w-24 overflow-hidden rounded-full page-skeleton" role="status" aria-label="Cargando página" />
      )}
      <p className="sr-only" aria-live="polite">Página {cur} de {pageCount}</p>
    </div>
  );
});
export default BookMode;
