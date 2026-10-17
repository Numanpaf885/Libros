"use client";
import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";

const LINKS = [
  { href: "/#catalogo", label: "Catálogo" },
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#contacto", label: "Contacto" },
];

export default function SiteHeader({ siteName }: { siteName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">{siteName}</Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-ctl px-3 py-2 text-[15px] text-muted transition-colors hover:text-fg">{l.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button type="button" className="btn btn-icon md:hidden" aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} aria-controls="menu-movil" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {open && (
        <nav id="menu-movil" aria-label="Principal" className="border-t border-line bg-bg px-4 py-2 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block border-b border-line py-3 text-base last:border-b-0">{l.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
