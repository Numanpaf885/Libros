/* eslint-disable @next/next/no-img-element */
import { ViewTransition } from "react";
// Covers come from a public presigned redirect. The surrounding UI stays neutral; the cover brings the colour.
export default function Cover({ slug, title, className = "", eager = false, transition = false }: { slug: string; title: string; className?: string; eager?: boolean; transition?: boolean }) {
  const box = (
    <div className={`aspect-[3/4] overflow-hidden rounded-card border border-line bg-surface ${className}`}>
      <img src={`/api/books/${slug}/cover`} alt={`Portada de ${title}`} loading={eager ? "eager" : "lazy"} className="h-full w-full object-cover object-top" />
    </div>
  );
  // The cover grows from the catalogue into the book page (same name on both sides).
  return transition ? <ViewTransition name={`cover-${slug}`} share="morph" default="none">{box}</ViewTransition> : box;
}
