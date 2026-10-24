"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

// The site only has necessary cookies and preferences (LSSI-CE art. 22.2: no consent needed), so this is a notice, not a
// consent banner: small, never blocking, shown once. Hidden in the reader and in the admin so it never covers controls.
// If an analytics or advertising cookie is ever added, this must become a real consent banner with "Rechazar" first.
const KEY = "br:cookies";
const listeners = new Set<() => void>();
let hiddenNow = false; // dismissed while storage is unavailable: at least stay closed until the page is reloaded
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
function dismissed(): boolean {
  if (hiddenNow) return true;
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
function dismiss() {
  hiddenNow = true;
  try { localStorage.setItem(KEY, "1"); } catch { /* not remembered: shown again next visit */ }
  for (const cb of listeners) cb();
}

export default function CookieNotice() {
  const done = useSyncExternalStore(subscribe, dismissed, () => true);
  const path = usePathname();
  if (done || path.startsWith("/admin")) return null;
  return (
    <section aria-label="Aviso de cookies" data-testid="cookie-notice"
      className="cookie-notice fade-in fixed inset-x-3 z-40 mx-auto max-w-md rounded-card border border-line bg-bg p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:left-4 sm:right-auto sm:mx-0"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <p className="text-[15px] leading-6">Este sitio solo usa cookies técnicas necesarias y preferencias guardadas en tu dispositivo.</p>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Link href="/cookies" className="btn btn-sm">Más información</Link>
        <button type="button" className="btn btn-sm btn-primary" onClick={dismiss}>Entendido</button>
      </div>
    </section>
  );
}
