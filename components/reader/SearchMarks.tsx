"use client";
import { useMarks } from "@/lib/client/search";

/** The matches of the current search on page n, highlighted over the page image (fractions of the page). */
export default function SearchMarks({ n }: { n: number }) {
  const boxes = useMarks(n);
  if (!boxes.length) return null;
  return (
    <div className="search-marks" aria-hidden="true" data-testid="search-marks">
      {boxes.map((b, i) => <span key={i} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}
    </div>
  );
}
