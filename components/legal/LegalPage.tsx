import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import type { Legal } from "@/lib/legal";
import { longDate } from "@/lib/legal";
import { SITE_NAME } from "@/lib/site";

/** Privacidad, Cookies and Aviso legal: same header and footer as the rest of the site, text in one readable column. */
export default function LegalPage({ title, legal, children }: { title: string; legal: Legal; children: React.ReactNode }) {
  const updated = longDate(legal.updated);
  return (
    <>
      <SiteHeader siteName={SITE_NAME} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        <article className="legal" data-testid="legal-page">
          <h1 className="text-4xl sm:text-5xl">{title}</h1>
          {updated && <p className="hint mt-3" data-testid="legal-date">Última actualización: {updated}</p>}
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

/** Who is responsible and how to reach them. Only the details filled in under Ajustes legales are shown. */
export function Owner({ legal }: { legal: Legal }) {
  const lines: [string, React.ReactNode][] = [];
  if (legal.owner) lines.push(["Responsable", legal.owner]);
  if (legal.city) lines.push(["Ciudad", legal.city]);
  if (legal.email) lines.push(["Email", <a key="e" href={`mailto:${legal.email}`}>{legal.email}</a>]);
  lines.push(["Formulario", <a key="f" href="/contacto">Contacto</a>]);
  return (
    <dl className="panel grid gap-x-6 gap-y-1 p-4 text-[15px] sm:grid-cols-[9rem_minmax(0,1fr)]" data-testid="legal-owner">
      {lines.map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="mb-1 sm:mb-0">{v}</dd></div>
      ))}
    </dl>
  );
}

/** "escribe a {email}" when there is a contact email, otherwise "escríbenos desde Contacto". */
export function WriteTo({ legal }: { legal: Legal }) {
  return legal.email
    ? <>escribe a <a href={`mailto:${legal.email}`}>{legal.email}</a> o usa el formulario de <a href="/contacto">Contacto</a></>
    : <>escríbenos desde el formulario de <a href="/contacto">Contacto</a></>;
}
