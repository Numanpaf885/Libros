"use client";
import Link from "next/link";
import { useState } from "react";
import AccountMenu from "@/components/account/AccountMenu";
import { LogoLockup } from "@/components/brand/Logo";
import Icon from "@/components/ui/Icon";
import Sheet, { usePhone } from "@/components/ui/Sheet";
import ThemeToggle from "@/components/ui/ThemeToggle";

const LINKS = [
  { href: "/#catalogo", label: "Catálogo" },
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#contacto", label: "Contacto" },
];

export default function SiteHeader({ siteName, largeTitle = false }: { siteName: string; largeTitle?: boolean }) {
  const [open, setOpen] = useState(false);
  const phone = usePhone(767); // below md the menu is a bottom sheet
  return (
    <header className={`glass sticky top-0 z-40 ${largeTitle ? "has-large-title" : ""}`} style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="press -ml-1 inline-flex min-h-11 items-center rounded-ctl px-1" aria-label={`${siteName}, inicio`}>
          <LogoLockup name={siteName} />
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-ctl px-3 text-[15px] text-glass-muted transition-colors hover:text-fg">{l.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <AccountMenu />
          <ThemeToggle className="border-transparent bg-transparent" />
          <button type="button" className="btn btn-icon min-h-11 min-w-11 border-transparent bg-transparent md:hidden" aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      <Sheet open={open && phone} onClose={() => setOpen(false)} label="Menú">
        <nav aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex min-h-14 items-center border-b border-line text-lg last:border-b-0">{l.label}</Link>
          ))}
        </nav>
      </Sheet>
    </header>
  );
}
