"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AccountMenu from "@/components/account/AccountMenu";
import { LogoLockup } from "@/components/brand/Logo";
import Icon from "@/components/ui/Icon";
import Sheet, { usePhone } from "@/components/ui/Sheet";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { postJson } from "@/lib/client/api";
import { setMe, useMe } from "@/lib/client/me";

const LINKS = [
  { href: "/#catalogo", label: "Catálogo" },
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/contacto", label: "Contacto" },
];
const rowCls = "press flex min-h-14 w-full items-center border-b border-line text-left text-lg";

export default function SiteHeader({ siteName, largeTitle = false }: { siteName: string; largeTitle?: boolean }) {
  const [open, setOpen] = useState(false);
  const phone = usePhone(767); // below md the menu is a bottom sheet
  const opener = useRef<HTMLButtonElement>(null);
  const { status, user } = useMe();
  const path = usePathname();
  const router = useRouter();

  /** Close the sheet first, then scroll smoothly to the section (the header offset comes from scroll-padding-top). */
  function go(e: React.MouseEvent, href: string) {
    const id = href.split("#")[1];
    setOpen(false);
    if (!id || path !== "/") { return; } // another page: the link navigates and Next scrolls to the section
    e.preventDefault();
    window.setTimeout(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", href);
    }, 280);
  }
  async function logout() {
    setOpen(false);
    try { await postJson("/api/me/logout"); } catch { /* the cookie is cleared server-side on the next visit */ }
    setMe(null);
    router.refresh();
  }

  return (
    <header className={`site-header ${largeTitle ? "has-large-title" : ""}`}>
      <div className="glass-float mx-auto flex h-16 w-full max-w-[1200px] items-center gap-2 px-2 sm:gap-6 sm:px-5">
        <Link href="/" className="press inline-flex min-h-11 shrink-0 items-center rounded-ctl px-1" aria-label={`${siteName}, inicio`}>
          <LogoLockup name={siteName} />
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-ctl px-3 text-[15px] text-glass-muted transition-colors hover:text-fg"><span className="ulink">{l.label}</span></Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <AccountMenu />
          <ThemeToggle className="btn-ghost" />
          <button ref={opener} type="button" className="btn btn-icon btn-ghost min-h-11 min-w-11 md:hidden" aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      <Sheet open={open && phone} onClose={() => setOpen(false)} label="Menú" returnFocus={opener}>
        <nav aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={(e) => go(e, l.href)} className={rowCls}>{l.label}</Link>
          ))}
          {status === "ready" && !user && <Link href="/entrar" onClick={() => setOpen(false)} className={rowCls}>Entrar</Link>}
          {status === "ready" && user && (
            <>
              <Link href="/cuenta" onClick={() => setOpen(false)} className={rowCls}>Mi cuenta</Link>
              <button type="button" onClick={logout} className={rowCls}>Salir</button>
            </>
          )}
          <div className="flex min-h-14 items-center justify-between text-lg">
            <span>Tema</span>
            <ThemeToggle className="btn-ghost" />
          </div>
        </nav>
      </Sheet>
    </header>
  );
}
