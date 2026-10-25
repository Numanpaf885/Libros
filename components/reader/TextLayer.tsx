"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { afterTurn, loadPageText, peekPageText, registerLayer } from "@/lib/client/text";
import { pageLayout, ROTATED, type TextItem } from "@/lib/text-layer";

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
 * stretched along its baseline to the printed width (rotated text turned to its angle), so a selection covers the
 * printed words. Body text comes first, in reading order; the margin (running header and footer, side tabs, rotated
 * text) comes after it in its own container, so a drag through the body never crosses it. Pages without text render nothing.
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
  const layout = useMemo(() => (items?.length ? pageLayout(items, ratio) : null), [items, ratio]);
  const spans = useMemo(() => (items ?? []).map((it) => {
    const size = it.h * h;
    const natural = widthOf(it.s) * size;
    const sx = natural > 0 ? (it.w * REF) / natural : 1;
    // rotated text turns around its starting corner: r is counter-clockwise, CSS rotate() is clockwise
    return { left: it.x * REF, top: it.y * h, size, transform: it.r ? `rotate(${-it.r}deg) scaleX(${sx})` : `scaleX(${sx})` };
  }), [items, h]);
  useEffect(() => {
    if (!el.current || !items?.length || !layout) return;
    return registerLayer(el.current, { page: n, items, ratio, layout });
  }, [items, n, ratio, layout]);
  if (!items?.length || !layout) return null;
  const span = (i: number) => (
    <span key={i} data-i={i} className={layout.kind[i] === ROTATED ? "tl-rot" : undefined} style={{ left: spans[i].left, top: spans[i].top, fontSize: spans[i].size, transform: spans[i].transform }}>{items[i].s}</span>
  );
  return (
    <div ref={el} className="text-layer" data-text-page={n} style={{ width: REF, height: h, transform: `scale(${width / REF})` }}>
      {layout.order.slice(0, layout.body).map(span)}
      {layout.body < layout.order.length && <div className="text-margin">{layout.order.slice(layout.body).map(span)}</div>}
    </div>
  );
}
export default memo(TextLayer);
