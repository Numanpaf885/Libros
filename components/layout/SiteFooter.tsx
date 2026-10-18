import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SITE_CONTACT, SITE_LINKS, SITE_NAME, SITE_INTRO } from "@/lib/site";

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
          {SITE_LINKS.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {SITE_LINKS.map((l) => (
                <li key={l.label}><a href={l.href} className="link text-[15px]" target={l.href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">{l.label}</a></li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[15px] text-muted">{SITE_CONTACT}</p>
          )}
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto w-full max-w-[1200px] px-4 py-4 text-sm text-muted sm:px-6">© {new Date().getFullYear()} {SITE_NAME}</p>
      </div>
    </footer>
  );
}
