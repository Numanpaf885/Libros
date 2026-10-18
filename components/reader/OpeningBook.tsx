"use client";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand/Logo";

const MIN_MS = 1500;

/**
 * "Opening the book": the cover lifts and opens on its left edge, the mark levels out, a thin line fills.
 * The line and the mark follow min(load progress, time) so they never jump. With reduced motion this
 * is just a still mark and text that fades out (see .opening-out).
 */
export default function OpeningBook({ slug, title, progress, out, reduced }: { slug: string; title: string; progress: { current: number }; out: boolean; reduced: boolean }) {
  const bar = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t0 = performance.now();
    let id = 0;
    const tick = () => {
      const shown = out ? 1 : Math.min(progress.current, 0.06 + 0.94 * Math.min(1, (performance.now() - t0) / MIN_MS));
      if (bar.current) bar.current.style.transform = `scaleX(${shown})`;
      root.current?.style.setProperty("--lp", String(shown));
      if (!out) id = requestAnimationFrame(tick); else tick0();
    };
    const tick0 = () => {
      if (bar.current) bar.current.style.transform = "scaleX(1)";
      root.current?.style.setProperty("--lp", "1");
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [out, progress]);

  return (
    <div
      ref={root}
      className={`fixed inset-0 z-50 grid place-items-center bg-bg text-fg ${out ? "opening-out" : "fade-in"}`}
      role="status"
      aria-label="Abriendo libro"
      style={{ ["--lp" as string]: 0 }}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <Logo size={56} className="text-accent" tilt={!reduced} />
        {!reduced && (
          <div className="opening-scene" aria-hidden="true">
            <div className="open-book">
              <div className="inside">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
              <div className="cover">
                <div className="front">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/books/${encodeURIComponent(slug)}/cover`} alt="" />
                </div>
                <div className="back" />
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          <p className="font-serif text-lg font-semibold">Abriendo libro…</p>
          <p className="sr-only">{title}</p>
          <div className="opening-bar" aria-hidden="true"><i ref={bar} /></div>
        </div>
      </div>
    </div>
  );
}
