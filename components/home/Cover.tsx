/* eslint-disable @next/next/no-img-element */
// Covers come from a public presigned redirect. The surrounding UI stays neutral; the cover brings the colour.
export default function Cover({ slug, title, className = "", eager = false }: { slug: string; title: string; className?: string; eager?: boolean }) {
  return (
    <div className={`aspect-[3/4] overflow-hidden rounded-card border border-line bg-surface ${className}`}>
      <img src={`/api/books/${slug}/cover`} alt={`Portada de ${title}`} loading={eager ? "eager" : "lazy"} className="h-full w-full object-cover object-top" />
    </div>
  );
}
