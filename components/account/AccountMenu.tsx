"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client/api";
import { setMe, useMe } from "@/lib/client/me";

/** "Entrar" when signed out; a round initial with a small menu when signed in. */
export default function AccountMenu() {
  const { status, user } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  // Reserve the space while we ask the server, so the header does not jump.
  if (status !== "ready") return <span aria-hidden="true" className="inline-block h-11 w-[4.25rem]" />;
  if (!user) {
    return <Link href="/entrar" className="btn min-h-11 border-transparent bg-transparent px-3 text-[15px]">Entrar</Link>;
  }
  const initial = (user.display_name || user.username).trim().charAt(0).toUpperCase() || "?";
  async function logout() {
    setOpen(false);
    try { await postJson("/api/me/logout"); } catch { /* the cookie is cleared server-side on the next visit */ }
    setMe(null);
    router.refresh();
  }
  return (
    <div ref={root} className="relative">
      <button
        type="button" className="press grid h-11 w-11 place-items-center rounded-full" aria-label={`Cuenta de ${user.display_name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-fg">{initial}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Cuenta" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-card border border-line-strong bg-bg py-1 shadow-[var(--shadow-float)]">
          <p className="truncate px-4 pb-2 pt-2 text-sm text-muted">{user.display_name}</p>
          <Link role="menuitem" href="/cuenta" onClick={() => setOpen(false)} className="flex min-h-11 items-center px-4 text-[15px] hover:bg-surface">Mi cuenta</Link>
          <button role="menuitem" type="button" onClick={logout} className="flex min-h-11 w-full items-center px-4 text-left text-[15px] hover:bg-surface">Salir</button>
        </div>
      )}
    </div>
  );
}
