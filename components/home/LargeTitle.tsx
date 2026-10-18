"use client";
import { useEffect } from "react";

/**
 * iOS-style large title: it shrinks and fades as the page scrolls while the header title fades in.
 * Sets --lt (0..1) on <html>; the CSS (.large-title, .has-large-title) does the rest.
 */
export default function LargeTitle({ title, intro }: { title: string; intro: string }) {
  useEffect(() => {
    const el = document.documentElement;
    let raf = 0;
    const update = () => { raf = 0; el.style.setProperty("--lt", String(Math.min(1, Math.max(0, (window.scrollY - 24) / 72)))); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("--lt");
    };
  }, []);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-2 pt-8 sm:px-6 md:pt-12">
      <h1 className="large-title text-[40px] font-semibold leading-tight tracking-tight md:text-[52px]">{title}</h1>
      <p className="mt-2 max-w-xl text-[17px] text-muted">{intro}</p>
    </div>
  );
}
