"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet with a grab handle. Swipe the handle (or the title area) down to close.
 * Always a bottom sheet; callers only use it on phones.
 */
export default function Sheet({ open, onClose, label, children, returnFocus }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; returnFocus?: React.RefObject<HTMLElement | null> }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y0: number; t0: number; id: number } | null>(null);

  // mount / unmount around the exit animation (state follows the prop; both set in one place on purpose)
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); (returnFocus?.current ?? opener.current)?.focus?.({ preventScroll: true }); }, 250);
    return () => clearTimeout(t);
  }, [open, mounted, returnFocus]);

  // Scroll lock that keeps the position: the page is simply not scrollable while the sheet is open
  // (no position:fixed on the body, so scrollY is never reset), and focus never scrolls.
  useEffect(() => {
    if (!mounted) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => { el.style.overflow = prev; };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const a = document.activeElement;
        if (e.shiftKey && (a === f[0] || a === panel.current)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  const down = (e: React.PointerEvent) => {
    drag.current = { y0: e.clientY, t0: performance.now(), id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panel.current) panel.current.style.animation = "none";
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !panel.current) return;
    const dy = Math.max(0, e.clientY - d.y0);
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const up = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !panel.current) return;
    drag.current = null;
    const dy = Math.max(0, e.clientY - d.y0);
    const v = dy / Math.max(1, performance.now() - d.t0); // px per ms
    if (dy > 110 || v > 0.6) { onClose(); return; }
    panel.current.style.transition = "transform 380ms var(--spring)";
    panel.current.style.transform = "";
    setTimeout(() => { if (panel.current) panel.current.style.transition = ""; }, 400);
  }, [onClose]);

  if (!mounted) return null;
  // In a portal: a parent with backdrop-filter (the header) would otherwise become the containing block of this fixed layer.
  return createPortal(
    <div className={`fixed inset-0 z-[90] w-full max-w-[100vw] overflow-hidden ${closing ? "sheet-closing" : ""}`}>
      <button type="button" tabIndex={-1} aria-label="Cerrar al tocar fuera" className="sheet-backdrop absolute inset-0 h-full w-full bg-black/40 touch-none" onClick={onClose} />
      <div
        ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="sheet-panel absolute inset-x-0 bottom-0 left-0 right-0 w-full max-w-full max-h-[88dvh] overflow-y-auto overscroll-contain overscroll-y-contain rounded-t-[16px] border border-b-0 border-line bg-bg shadow-[var(--shadow-float)] outline-none"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div
          className="flex h-11 cursor-grab touch-none items-center justify-center"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        >
          <span className="h-1.5 w-10 rounded-full bg-line-strong/60" aria-hidden="true" />
        </div>
        <button type="button" className="btn btn-icon btn-ghost absolute right-1 top-0 min-h-11 min-w-11" aria-label="Cerrar" data-sheet-close onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="px-5 pb-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** True on phones (below Tailwind's sm). Server render and first paint assume "not a phone". */
export function usePhone(max = 639) {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${max}px)`);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [max]);
  return phone;
}
