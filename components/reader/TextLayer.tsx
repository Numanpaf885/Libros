"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { afterTurn, loadPageText, peekPageText, registerLayer } from "@/lib/client/text";
import type { TextItem } from "@/lib/text-layer";

/** The layer is laid out once at this width and scaled with a single transform: zoom never lays it out again. */
const REF = 1000;
const FONT = "sans-serif";
let ctx: CanvasRenderingContext2D | null | undefined;
/** Width of `s` at a font size of 1 px. */
function widthOf(s: string): number {
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `100px ${FONT}`;
  return ctx.measureText(s).width / 100;
}

interface Props {
  slug: string;
  n: number;
  /** on-screen width of the page image in CSS pixels */
  width: number;
  /** height / width of the page image */
  ratio: number;
}

/**
 * The page's text, invisible, exactly over its image: one transparent span per line (or word), as tall as the text and
 * stretched horizontally to the printed width, so a selection covers the printed words. Pages without text render nothing.
 */
function TextLayer({ slug, n, width, ratio }: Props) {
  const [items, setItems] = useState<readonly TextItem[] | null>(() => peekPageText(slug, n) ?? null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    loadPageText(slug, n).then((it) => afterTurn(() => { if (!dead) setItems(it); }), () => {});
    return () => { dead = true; };
  }, [slug, n]);
  const h = REF * ratio;
  const spans = useMemo(() => (items ?? []).map((it) => {
    const size = it.h * h;
    const natural = widthOf(it.s) * size;
    return { left: it.x * REF, top: it.y * h, size, sx: natural > 0 ? (it.w * REF) / natural : 1 };
  }), [items, h]);
  useEffect(() => {
    if (!el.current || !items?.length) return;
    return registerLayer(el.current, { page: n, items, ratio });
  }, [items, n, ratio]);
  if (!items?.length) return null;
  return (
    <div ref={el} className="text-layer" data-text-page={n} style={{ width: REF, height: h, transform: `scale(${width / REF})` }}>
      {items.map((it, i) => (
        <span key={i} data-i={i} style={{ left: spans[i].left, top: spans[i].top, fontSize: spans[i].size, transform: `scaleX(${spans[i].sx})` }}>{it.s}</span>
      ))}
    </div>
  );
}
export default memo(TextLayer);
