"use client";
import { fmtSize } from "@/lib/client/format";
import type { OriginalProgress } from "@/lib/client/multipart";

/** Progress bar of the original-PDF upload (bytes, not pages). */
export default function BytesProgress({ p, label = "Subiendo el PDF original…" }: { p: OriginalProgress | null; label?: string }) {
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="space-y-2" role="status" data-testid="original-progress">
      <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label="Progreso de la subida del PDF original" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum text-sm text-muted">
        {p ? `${label} ${fmtSize(p.done)} / ${fmtSize(p.total)} · ${pct} %${p.resumed ? " · continuando" : ""}` : label}
      </p>
    </div>
  );
}
