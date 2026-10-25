"use client";
import Icon from "./Icon";

/**
 * What every page and panel shows when it could not load (Google Sheets or the storage did not answer in time, or the
 * connection dropped): a short Spanish explanation and "Reintentar". Never an endless spinner.
 */
export default function ErrorState({ title = "No se ha podido cargar", text = "El servicio no responde ahora mismo. Inténtalo de nuevo en unos segundos.", onRetry, busy = false, className = "" }: {
  title?: string;
  text?: string;
  onRetry: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={`card max-w-md p-6 ${className}`} data-testid="error-state">
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="hint mt-1">{text}</p>
      <button type="button" className="btn btn-primary mt-4 min-h-11" onClick={onRetry} disabled={busy} aria-busy={busy}>
        <Icon name="rotate" size={18} />{busy ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}
