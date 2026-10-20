"use client";
export type SourceKind = "pdf" | "images";

/** iOS-style segmented control: "PDF" | "Imágenes" (what a book is made from). */
export default function SourceSwitch({ value, onChange, disabled }: { value: SourceKind; onChange: (v: SourceKind) => void; disabled?: boolean }) {
  const items: { v: SourceKind; label: string }[] = [{ v: "pdf", label: "PDF" }, { v: "images", label: "Imágenes" }];
  return (
    <div className="seg" role="radiogroup" aria-label="Origen de las páginas" data-value={value}>
      <span className="thumb" aria-hidden="true" />
      {items.map((it) => (
        <button
          key={it.v} type="button" role="radio" aria-checked={value === it.v} disabled={disabled}
          onClick={() => onChange(it.v)}
          onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); onChange(value === "pdf" ? "images" : "pdf"); } }}
          tabIndex={value === it.v ? 0 : -1}
        >{it.label}</button>
      ))}
    </div>
  );
}
