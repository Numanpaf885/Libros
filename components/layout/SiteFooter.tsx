import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SITE_CONTACT, SITE_LINKS, SITE_NAME, SITE_INTRO } from "@/lib/site";

const LEGAL = [
  { href: "/privacidad", label: "Privacidad" },
  { href: "/cookies", label: "Cookies" },
  { href: "/aviso-legal", label: "Aviso legal" },
  { href: "/contacto", label: "Contacto" },
];

/** Privacidad · Cookies · Aviso legal · Contacto: at the bottom of every page (the admin shows only this line). */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center ${className}`}>
      {LEGAL.map((l, i) => (
        <span key={l.href} className="inline-flex items-center">
          {i > 0 && <span aria-hidden="true" className="px-1">·</span>}
          <Link href={l.href} className="inline-flex min-h-11 items-center px-1 transition-colors hover:text-fg"><span className="ulink">{l.label}</span></Link>
        </span>
      ))}
    </nav>
  );
}

export default function SiteFooter() {
  return (
    <footer id="contacto" className="mt-auto border-t border-line bg-surface" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div className="max-w-md">
          <Link href="/" className="press inline-flex min-h-11 items-center gap-2.5 font-serif text-2xl font-semibold"><Logo size={30} className="text-accent" />{SITE_NAME}</Link>
          <p className="mt-2 text-[15px] text-muted">{SITE_INTRO}</p>
        </div>
        <div>
          <h2 className="font-sans text-base font-semibold">Contacto</h2>
          <ul className="mt-2 space-y-1.5">
            <li><Link href="/contacto" className="link text-[15px]">Escríbenos</Link></li>
            {SITE_LINKS.map((l) => (
              <li key={l.label}><a href={l.href} className="link text-[15px]" target={l.href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">{l.label}</a></li>
            ))}
          </ul>
          {SITE_LINKS.length === 0 && <p className="mt-2 text-[15px] text-muted">{SITE_CONTACT}</p>}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm text-muted sm:px-6">
          <p>© {new Date().getFullYear()} {SITE_NAME}</p>
          <LegalLinks />
        </div>
      </div>
    </footer>
  );
}
