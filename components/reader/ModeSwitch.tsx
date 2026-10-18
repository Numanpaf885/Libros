"use client";
export type ReadMode = "book" | "pdf";

/** iOS-style segmented control: "Libro" | "PDF". */
export default function ModeSwitch({ value, onChange }: { value: ReadMode; onChange: (m: ReadMode) => void }) {
  const items: { v: ReadMode; label: string }[] = [{ v: "book", label: "Libro" }, { v: "pdf", label: "PDF" }];
  return (
    <div className="seg" role="radiogroup" aria-label="Modo de lectura" data-value={value}>
      <span className="thumb" aria-hidden="true" />
      {items.map((it) => (
        <button
          key={it.v} type="button" role="radio" aria-checked={value === it.v}
          onClick={(e) => { onChange(it.v); if (e.detail > 0) e.currentTarget.blur(); /* pointer click: arrows go back to turning pages */ }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); onChange(value === "book" ? "pdf" : "book"); }
          }}
          tabIndex={value === it.v ? 0 : -1}
        >{it.label}</button>
      ))}
    </div>
  );
}
