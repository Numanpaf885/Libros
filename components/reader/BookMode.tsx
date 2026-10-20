"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Icon from "@/components/ui/Icon";
import { getFace, holdFaces, prepareFace, trimFaces } from "@/lib/client/faces";
import { loadPage, peekPage, trimPages, Unauthorized } from "@/lib/client/pages";
import { pageOfUnit, pagesOfUnit, realPages, unitCount, unitOf, windowUnits } from "@/lib/client/spreads";

export type PageEffect = "turn" | "slide" | "none";
export interface BookHandle { turn(dir: 1 | -1): void }
interface Props {
  slug: string;
  pageCount: number;
  /** Current page (shared with PDF mode). */
  page: number;
  /** height / width of a page */
  ratio: number;
  box: { w: number; h: number };
  effect: PageEffect;
  /** pages that have a bookmark (a ribbon is drawn on them) */
  marks?: ReadonlySet<number>;
  /** printed number of a file page, for screen readers (default: the file page itself) */
  nameOf?: (n: number) => string;
  onPage: (n: number) => void;
  onExpired: () => void;
}

type Styles = Record<string, Record<string, string>>;
type Run = { target: 0 | 1; v0: number; kind: "tween" | "spring"; fast: boolean };
type El = HTMLElement | null;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const KEEP_DISTANCE = 3; // decoded pages further than this many units away are dropped
const TWEEN_MS = 550;
const ANGLE_SINGLE = 100;
/** Background work (prefetch, decoding, drawing, fresh presigned URLs) never runs while a page turns. */
let turning: () => boolean = () => false;
const idle = (fn: () => void) => {
  if (turning()) { setTimeout(() => idle(fn), 120); return; }
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 120 }); else setTimeout(fn, 30);
};

/** One page: its canvas (never an <img>), drawn before it is ever shown, or a shimmering skeleton. */
function PageFace({ slug, n, w, h, version, failed, marked, side }: { slug: string; n: number; w: number; h: number; version: number; failed: boolean; marked: boolean; side: "l" | "r" }) {
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
      {marked && <span className={`bm-ribbon ${side === "l" ? "bm-ribbon-l" : ""}`} data-testid="bookmark-ribbon" aria-hidden="true" />}
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted">No se ha podido cargar esta página.</p>}
    </div>
  );
}

/** A pre-made gradient layer: only its opacity is animated (never box-shadow or filter). */
function Shade({ r, side, dark = 0.38 }: { r: (e: HTMLDivElement | null) => void; side: "left" | "right"; dark?: number }) {
  return <div ref={r} data-shade className="pointer-events-none absolute inset-0" style={{ opacity: 0, background: `linear-gradient(to ${side === "left" ? "right" : "left"}, rgba(0,0,0,${dark}), rgba(0,0,0,0) 55%)` }} />;
}

const BookMode = forwardRef<BookHandle, Props>(function BookMode({ slug, pageCount, page, ratio, box, effect, marks, nameOf, onPage, onExpired }, handle) {
  const wide = box.w >= 1024 && box.w > box.h;
  const total = unitCount(pageCount, wide);
  const [unit, setUnit] = useState(() => clamp(unitOf(page, wide), 0, total - 1));
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const markFailed = useCallback((n: number, bad: boolean) => setFailed((f) => (f.has(n) === bad ? f : (() => { const x = new Set(f); if (bad) x.add(n); else x.delete(n); return x; })())), []);

  const stage = useRef<HTMLDivElement>(null);
  const els = useRef<Record<string, El>>({});
  const refs = useRef<Record<string, (e: El) => void>>({});
  /** Stable callback ref per element name (a new function every render would detach and re-attach it). */
  const r = useCallback((name: string) => (refs.current[name] ??= (e: El) => { els.current[name] = e; }), []);

  const unitRef = useRef(unit);
  const busy = useRef(false); // a turn is reserved, loading or animating
  const animating = useRef(false); // the animation itself is running: React must stay out of it
  const dirty = useRef(false);
  const queue = useRef(0);
  const dirRef = useRef<0 | 1 | -1>(0);
  const pRef = useRef(0);
  const anims = useRef<Animation[]>([]);
  const raf = useRef(0);
  const dragRaf = useRef(0);
  const jumpToken = useRef(0);
  const renders = useRef(0);
  const again = useRef<(d: 1 | -1) => void>(() => {});
  const cb = useRef({ onPage, onExpired });
  useEffect(() => { cb.current = { onPage, onExpired }; });
  useEffect(() => { unitRef.current = unit; }, [unit]);
  useEffect(() => {
    const f = () => busy.current || animating.current;
    turning = f;
    holdFaces(f);
    return () => { if (turning === f) { turning = () => false; holdFaces(() => false); } };
  }, []);
  // render counter (read by the performance tests: it must not move while a page turns)
  useLayoutEffect(() => { if (stage.current) stage.current.dataset.renders = String(++renders.current); });

  // ---- geometry ----
  const pad = 12;
  const pw = Math.max(80, Math.floor(Math.min(wide ? box.w / 2 - 64 : box.w - 2 * pad, (box.h - 2 * pad) / ratio)));
  const ph = Math.round(pw * ratio);
  const sw = wide ? pw * 2 : pw;

  // ---- preloading: current + next 2 + previous 1 (spread-aware), fetched AND decoded. Starts when a turn has ended. ----
  const bump = useRef(0);
  const touchVersion = useCallback(() => {
    if (animating.current) { dirty.current = true; return; } // never re-render in the middle of a turn
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
    let dead = false;
    idle(() => {
      if (dead) return;
      for (const u of windowUnits(unit, total)) {
        const pages = realPages(u, wide, pageCount);
        ensure(pages).then(() => { for (const n of pages) prepareFace(slug, n, pw, ph); }, () => {});
      }
      trimPages(slug, near);
      trimFaces(slug, near, pw, ph);
    });
    return () => { dead = true; };
  }, [unit, total, wide, pageCount, slug, ensure, pw, ph]);
  useEffect(() => () => { if (bump.current) cancelAnimationFrame(bump.current); }, []);

  const isReady = useCallback((u: number) => realPages(u, wide, pageCount).every((n) => !!peekPage(slug, n)), [slug, wide, pageCount]);
  /** Is the page drawn in the DOM already (so that revealing it cannot show a skeleton)? */
  const shown = useCallback((n: number) => !!stage.current?.querySelector(`.page-face[data-page="${n}"][data-ready="1"]`), []);

  // ---- the moving parts: styles at progress p, for the current direction (pure) ----
  const stylesAt = useCallback((dir: 1 | -1, p: number): Styles => {
    const fwd = dir === 1;
    if (effect === "slide") {
      return { track: { transform: `translate3d(${fwd ? -sw * (1 + p) : -sw * (1 - p)}px,0,0)` } };
    }
    if (wide) {
      const fs = 0.4 * clamp(p * 2), bs = 0.4 * clamp((1 - p) * 2), dest = (1 - p) * Math.min(1, p * 10), other = p > 0.5 ? Math.sin(Math.PI * p) : 0;
      return fwd
        ? { leafR: { transform: `rotateY(${-180 * p}deg)` }, rFs: { opacity: String(fs) }, rBs: { opacity: String(bs) }, uRsh: { opacity: String(dest) }, lOther: { opacity: String(other) } }
        : { leafL: { transform: `rotateY(${180 * p}deg)` }, lFs: { opacity: String(fs) }, lBs: { opacity: String(bs) }, uLsh: { opacity: String(dest) }, rOther: { opacity: String(other) } };
    }
    const q = fwd ? p : 1 - p; // how far the leaf is lifted: 0 flat, 1 gone
    const ramp = String(q > 0.8 ? clamp((1 - q) / 0.2) : 1);
    const leaf = { transform: `rotateY(${-ANGLE_SINGLE * q}deg)`, opacity: ramp };
    const fsOp = { opacity: String(0.4 * clamp(q * 1.5)) };
    const destOp = { opacity: String(Math.sin(Math.PI * q) * 0.9) };
    return fwd ? { lC: leaf, lCfs: fsOp, uNsh: destOp } : { lP: leaf, lPfs: fsOp, lCdest: destOp };
  }, [effect, wide, sw]);

  const write = useCallback((dir: 1 | -1, p: number) => {
    const st = stylesAt(dir, p);
    for (const k in st) { const e = els.current[k]; if (e) Object.assign(e.style, st[k]); }
  }, [stylesAt]);

  const clearHints = useCallback(() => { for (const k in els.current) { const e = els.current[k]; if (e) e.style.willChange = ""; } }, []);

  const finish = useCallback((committed: boolean) => {
    const dir = dirRef.current;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (dir) write(dir, committed ? 1 : 0);
    const settle = () => {
      for (const a of anims.current) a.cancel(); // inline styles already hold the final values
      anims.current = [];
      animating.current = false;
      dirRef.current = 0;
      const to = unitRef.current + dir;
      if (committed && dir) {
        // One React commit AFTER the animation: the rig is rebuilt for the new unit (keyed), nothing flickers.
        flushSync(() => setUnit(to));
        unitRef.current = to;
        cb.current.onPage(pageOfUnit(to, wide));
      } else {
        clearHints();
        const z = els.current;
        if (z.leafL) z.leafL.style.zIndex = "";
        if (z.leafR) z.leafR.style.zIndex = "";
      }
      busy.current = false;
      if (dirty.current) { dirty.current = false; touchVersion(); }
      if (queue.current !== 0) {
        const d = queue.current > 0 ? 1 : -1;
        queue.current -= d;
        setTimeout(() => again.current(d), 0);
      }
    };
    if (committed && dir && queue.current === 0) {
      // The last frame stays on screen (animation fill) while React rebuilds the rig when the browser is idle.
      const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(settle, { timeout: 150 }); else setTimeout(settle, 40);
    } else settle();
  }, [write, clearHints, touchVersion, wide]);

  /** Progress samples every ~16 ms for a tween or a spring, ending exactly on the target. */
  const simulate = useCallback((run: Run, from: number) => {
    const out = [from];
    const H = 1 / 60;
    if (run.kind === "tween") {
      const dur = ((run.fast ? 0.5 : 1) * TWEEN_MS * Math.max(0.35, Math.abs(run.target - from))) / 1000;
      const n = Math.max(2, Math.round(dur / H));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease-in-out
        out.push(from + (run.target - from) * e);
      }
      return out;
    }
    const K = 230, C = 27; // spring, ~0.9 of critical damping
    let x = from, v = run.v0;
    for (let i = 0; i < 54; i++) {
      for (let j = 0; j < 4; j++) { v += (-K * (x - run.target) - C * v) * (H / 4); x += v * (H / 4); }
      x = clamp(x);
      out.push(x);
      if (Math.abs(x - run.target) < 0.002 && Math.abs(v) < 0.05) break;
    }
    out[out.length - 1] = run.target;
    return out;
  }, []);

  /** Compositor-driven: transform / opacity keyframes through element.animate(); the main thread does nothing per frame. */
  const animate = useCallback((run: Run) => {
    const dir = dirRef.current;
    if (!dir) return;
    cancelAnimationFrame(raf.current);
    for (const a of anims.current) a.cancel();
    anims.current = [];
    animating.current = true;
    const samples = simulate(run, pRef.current);
    const n = samples.length;
    const sts = samples.map((p) => stylesAt(dir, p));
    const list: Animation[] = [];
    let canAnimate = true;
    for (const k of Object.keys(sts[0])) {
      const e = els.current[k];
      if (!e) continue;
      if (typeof e.animate !== "function") { canAnimate = false; break; }
      const frames = sts.map((s, i) => ({ ...s[k], offset: n === 1 ? 1 : i / (n - 1) }));
      list.push(e.animate(frames, { duration: Math.max(16, (n - 1) * (1000 / 60)), easing: "linear", fill: "forwards" }));
    }
    pRef.current = run.target;
    if (canAnimate && list.length) {
      anims.current = list;
      Promise.all(list.map((a) => a.finished)).then(() => finish(run.target === 1), () => { /* cancelled */ });
      return;
    }
    let i = 0; // fallback without the Web Animations API: one style write per frame
    const t0 = performance.now();
    const step = (now: number) => {
      i = Math.min(n - 1, Math.floor((now - t0) / (1000 / 60)));
      write(dir, samples[i]);
      if (i >= n - 1) return finish(run.target === 1);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [simulate, stylesAt, write, finish]);

  /** Prepare a turn: stacking order and will-change only while it lasts. No React state, no DOM mounted. */
  const begin = useCallback((dir: 1 | -1) => {
    dirRef.current = dir;
    pRef.current = 0;
    busy.current = true;
    const z = els.current;
    if (z.leafL && z.leafR) { z.leafR.style.zIndex = dir === 1 ? "3" : "2"; z.leafL.style.zIndex = dir === 1 ? "2" : "3"; }
    for (const k of Object.keys(stylesAt(dir, 0.5))) {
      const e = z[k];
      if (e && !e.hasAttribute("data-shade")) e.style.willChange = k === "track" ? "transform" : "transform, opacity";
    }
  }, [stylesAt]);

  /** Turn one unit. Starts only when the destination is decoded AND already drawn in the DOM. */
  const requestTurn = useCallback((dir: 1 | -1) => {
    if (busy.current) { queue.current += dir; return; }
    const from = unitRef.current;
    const to = from + dir;
    if (to < 0 || to >= total) return;
    const go = () => {
      if (effect === "none") {
        flushSync(() => setUnit(to));
        unitRef.current = to;
        busy.current = false;
        cb.current.onPage(pageOfUnit(to, wide));
        if (queue.current !== 0) { const d = queue.current > 0 ? 1 : -1; queue.current -= d; setTimeout(() => again.current(d), 0); }
        return;
      }
      const pages = realPages(to, wide, pageCount);
      if (!pages.every(shown)) flushSync(() => setVersion((v) => v + 1)); // draw them now, before the animation, never during it
      begin(dir);
      // one frame so the layers exist before the first animated frame
      requestAnimationFrame(() => animate({ target: 1, v0: 0, kind: "tween", fast: queue.current > 0 }));
    };
    busy.current = true; // reserved while we wait for the destination
    if (isReady(to)) { go(); return; }
    setPending(true);
    ensure(realPages(to, wide, pageCount)).then(() => { setPending(false); go(); }, () => { setPending(false); busy.current = false; });
  }, [total, effect, wide, pageCount, isReady, ensure, shown, begin, animate]);
  useEffect(() => { again.current = requestTurn; });
  useImperativeHandle(handle, () => ({ turn: requestTurn }), [requestTurn]);

  // ---- the page changed from outside (page box, #p=, mode switch, rotation): jump, no turn animation ----
  useEffect(() => {
    if (busy.current) return;
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
    if (busy.current) return;
    const u = clamp(unitOf(page, wide), 0, total - 1);
    if (u === unit) cb.current.onPage(pageOfUnit(u, wide));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  // ---- gestures: the drag follows the finger (rAF + direct style writes, no React state); edge taps turn ----
  const g = useRef<{ id: number; x0: number; y0: number; t0: number; dir: 0 | 1 | -1; hist: { t: number; p: number }[]; moved: boolean } | null>(null);
  const range = effect === "slide" ? sw * 0.9 : wide ? pw * 1.5 : pw * 0.95;
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
      if (effect === "none" || busy.current) return;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const to = unitRef.current + dir;
      if (to < 0 || to >= total) return;
      if (!isReady(to) || !realPages(to, wide, pageCount).every(shown)) { // never start on a page that is not decoded and drawn yet
        ensure(realPages(to, wide, pageCount)).then(() => flushSync(() => setVersion((v) => v + 1)), () => {});
        return;
      }
      s.dir = dir;
      animating.current = true;
      begin(dir);
    }
    const p = clamp(((s.dir === 1 ? -dx : dx)) / range);
    pRef.current = p;
    s.hist.push({ t: performance.now(), p });
    if (s.hist.length > 6) s.hist.shift();
    if (!dragRaf.current) {
      dragRaf.current = requestAnimationFrame(() => { dragRaf.current = 0; if (g.current?.dir) write(g.current.dir, pRef.current); });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    cancelAnimationFrame(dragRaf.current);
    dragRaf.current = 0;
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
    if (rel < 0.2) requestTurn(-1);
    else if (rel > 0.8) requestTurn(1);
  };
  const onCancel = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.dir) animate({ target: 0, v0: 0, kind: "spring", fast: false });
  };
  useEffect(() => () => { cancelAnimationFrame(raf.current); cancelAnimationFrame(dragRaf.current); }, []);

  // ---- render: everything a turn needs is mounted BEFORE it starts (keyed by unit, rebuilt once after each turn) ----
  const face = (n: number | null) => (n === null ? null : <PageFace key={n} slug={slug} n={n} w={pw} h={ph} version={version} failed={failed.has(n)} marked={!!marks?.has(n)} side={wide && n % 2 === 0 ? "l" : "r"} />);
  const slotCls = "absolute top-0 overflow-hidden bg-white outline outline-1 -outline-offset-1 outline-line";
  const pgs = (u: number) => pagesOfUnit(u, wide, pageCount);
  const [cl, cr] = pgs(unit);
  const [pl, pr] = pgs(unit - 1);
  const [nl, nr] = pgs(unit + 1);
  const hide = (n: number | null): React.CSSProperties => (n === null ? { visibility: "hidden" } : {});

  let rig: React.ReactNode;
  if (effect === "turn" && wide) {
    rig = (
      <>
        <div ref={r("uL")} className={slotCls} style={{ left: 0, width: pw, height: ph, ...hide(pl) }}>{face(pl)}<Shade r={r("uLsh")} side="right" /></div>
        <div ref={r("uR")} className={slotCls} style={{ left: pw, width: pw, height: ph, ...hide(nr) }}>{face(nr)}<Shade r={r("uRsh")} side="left" /></div>
        <div ref={r("leafL")} className="book-leaf absolute top-0" style={{ left: 0, width: pw, height: ph, transformOrigin: "right center", transformStyle: "preserve-3d", zIndex: 2 }}>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, ...hide(cl) }}>{face(cl)}<Shade r={r("lFs")} side="left" dark={0.45} /><Shade r={r("lOther")} side="right" /></div>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, transform: "rotateY(180deg)", ...hide(pr) }}>{face(pr)}<Shade r={r("lBs")} side="right" dark={0.45} /></div>
        </div>
        <div ref={r("leafR")} className="book-leaf absolute top-0" style={{ left: pw, width: pw, height: ph, transformOrigin: "left center", transformStyle: "preserve-3d", zIndex: 2 }}>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, ...hide(cr) }}>{face(cr)}<Shade r={r("rFs")} side="right" dark={0.45} /><Shade r={r("rOther")} side="left" /></div>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, transform: "rotateY(180deg)", ...hide(nl) }}>{face(nl)}<Shade r={r("rBs")} side="left" dark={0.45} /></div>
        </div>
      </>
    );
  } else if (effect === "turn") {
    rig = (
      <>
        <div ref={r("uN")} className={slotCls} style={{ left: 0, width: pw, height: ph, ...hide(nr) }}>{face(nr)}<Shade r={r("uNsh")} side="left" /></div>
        <div ref={r("lC")} className="book-leaf absolute top-0" style={{ left: 0, width: pw, height: ph, transformOrigin: "left center", zIndex: 2 }}>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, ...hide(cr) }}>{face(cr)}<Shade r={r("lCdest")} side="left" /><Shade r={r("lCfs")} side="left" dark={0.45} /></div>
        </div>
        <div ref={r("lP")} className="book-leaf absolute top-0" style={{ left: 0, width: pw, height: ph, transformOrigin: "left center", zIndex: 3, transform: `rotateY(${-ANGLE_SINGLE}deg)`, opacity: 0, pointerEvents: "none" }}>
          <div className={`book-face ${slotCls}`} style={{ left: 0, width: pw, height: ph, ...hide(pr) }}>{face(pr)}<Shade r={r("lPfs")} side="left" dark={0.45} /></div>
        </div>
      </>
    );
  } else {
    // "Deslizar" / "Ninguno": three units side by side in a clipped frame; the track slides (one element, transform only)
    const cell = (l: number | null, rr: number | null, i: number) => (
      <div key={i} className="relative shrink-0" style={{ width: sw, height: ph }}>
        {wide && l !== null && <div className={slotCls} style={{ left: 0, width: pw, height: ph }}>{face(l)}</div>}
        {rr !== null && <div className={slotCls} style={{ left: wide ? pw : 0, width: pw, height: ph }}>{face(rr)}</div>}
      </div>
    );
    rig = (
      <div className="absolute inset-0 overflow-hidden">
        <div ref={r("track")} className="flex" style={{ width: sw * 3, height: ph, marginLeft: -sw * 0, transform: `translate3d(${-sw}px,0,0)` }}>
          {cell(pl, pr, 0)}{cell(cl, cr, 1)}{cell(nl, nr, 2)}
        </div>
      </div>
    );
  }

  const cur = pageOfUnit(unit, wide);
  const outside = (box.w - sw) / 2 >= 56; // desktop: the arrows sit outside the page; phones: over its edges
  const arrowX = outside ? (box.w - sw) / 2 - 52 : 16;
  const arrow = "press absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-fg transition-opacity disabled:pointer-events-none disabled:opacity-25";
  const arrowBg = outside ? "hover:bg-fg/10" : "bg-bg/75 shadow-[0_1px_4px_rgba(0,0,0,0.25)]";
  return (
    <div ref={stage} className="absolute inset-0 cursor-grab active:cursor-grabbing" data-renders="0">
      <div
        className="absolute inset-0 touch-none overflow-hidden"
        style={{ overscrollBehavior: "none" }}
        role="group" aria-roledescription="libro" aria-label="Libro"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      >
        <div
          key={`${effect}-${unit}-${fadeKey}`}
          className={`absolute left-1/2 top-1/2 ${fadeKey ? "fade-in" : ""}`}
          style={{ width: sw, height: ph, marginLeft: -sw / 2, marginTop: -ph / 2, perspective: effect === "turn" ? Math.max(sw * 2.2, 1400) : undefined, perspectiveOrigin: "50% 50%" }}
          data-unit={unit}
          data-wide={wide ? "1" : "0"}
        >
          {rig}
        </div>
        {pending && <div className="pointer-events-none absolute inset-x-0 bottom-6 mx-auto h-1 w-24 overflow-hidden rounded-full page-skeleton" role="status" aria-label="Cargando página" />}
        <p className="sr-only" aria-live="polite">Página {nameOf ? nameOf(cur) : cur} de {pageCount}</p>
      </div>
      <button type="button" aria-label="Página anterior" title="Página anterior" disabled={unit <= 0} onClick={() => requestTurn(-1)} className={`${arrow} ${arrowBg}`} style={{ left: arrowX }}><Icon name="back" size={26} /></button>
      <button type="button" aria-label="Página siguiente" title="Página siguiente" disabled={unit >= total - 1} onClick={() => requestTurn(1)} className={`${arrow} ${arrowBg}`} style={{ right: arrowX }}><Icon name="next" size={26} /></button>
    </div>
  );
});
export default BookMode;
