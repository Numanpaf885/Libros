"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { drawPage, loadPage, Unauthorized } from "@/lib/client/pages";
import TextLayer from "./TextLayer";

interface Props {
  slug: string;
  n: number;
  width: number;
  height: number;
  /** Wait this long before fetching, so pages scrolled past quickly are never requested. */
  delay?: number;
  onRatio: (n: number, ratio: number) => void;
  onExpired: () => void;
  /** the page has a bookmark: show the ribbon */
  marked?: boolean;
  /** the book has selectable text: lay it over the page */
  text?: boolean;
}

/** Mounted only while its page is near the viewport; unmounting frees the pixel buffer. */
export default function PageCanvas({ slug, n, width, height, delay = 0, onRatio, onExpired, marked = false, text = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0); // "Reintentar" loads the page again

  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => {
      loadPage(slug, n)
        .then((bmp) => {
          if (dead || !canvas.current) return;
          drawPage(canvas.current, bmp);
          setFailed(false);
          setLoaded(true);
          onRatio(n, bmp.height / bmp.width);
        })
        .catch((e) => {
          if (dead) return;
          if (e instanceof Unauthorized) onExpired();
          else setFailed(true);
        });
    }, delay);
    return () => { dead = true; clearTimeout(t); };
  }, [slug, n, delay, onRatio, onExpired, attempt]);

  return (
    <div data-page={n} className={`relative overflow-hidden rounded-[3px] border border-line ${loaded ? "bg-white" : "skeleton"}`} style={{ width, height }}>
      {marked && <span className="bm-ribbon" data-testid="bookmark-ribbon" aria-hidden="true" />}
      {failed && (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 p-4 text-center" data-testid="page-failed">
          <p className="text-sm text-muted">No se ha podido cargar esta página.</p>
          <button type="button" className="btn btn-sm" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}><Icon name="rotate" size={16} />Reintentar</button>
        </div>
      )}
      <canvas ref={canvas} aria-label={`Página ${n}`} className={`block h-full w-full transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`} />
      {/* inside the 1 px border, like the canvas */}
      {text && loaded && <TextLayer slug={slug} n={n} width={width - 2} ratio={(height - 2) / (width - 2)} />}
    </div>
  );
}
