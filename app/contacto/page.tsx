import AuthPage from "@/components/account/AuthPage";
import ContactForm from "@/components/contact/ContactForm";
import { formToken } from "@/lib/contact-server";
import { messagesAvailable } from "@/lib/db/users";
import RetryButton from "@/components/ui/RetryButton";
import { SITE_CONTACT, SITE_LINKS } from "@/lib/site";
import { softly } from "@/lib/soft";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacto" };

export default async function ContactoPage() {
  // null: the sheet does not answer right now (the page says so and offers "Reintentar")
  const available = await softly(messagesAvailable(), null);
  return (
    <AuthPage wide>
      {available ? <ContactForm token={formToken()} /> : available === null ? (
        <div className="card space-y-3 p-6 sm:p-8" role="status">
          <h1 className="text-4xl">Contacto</h1>
          <p className="text-[17px]">Ahora mismo no podemos mostrar el formulario. Inténtalo de nuevo en unos segundos.</p>
          <RetryButton className="btn min-h-11" />
        </div>
      ) : (
        <div className="card space-y-3 p-6 sm:p-8">
          <h1 className="text-4xl">Contacto</h1>
          <p className="text-[17px]">El formulario de contacto estará disponible muy pronto.</p>
          {SITE_LINKS.length > 0 ? (
            <ul className="space-y-1.5">{SITE_LINKS.map((l) => <li key={l.label}><a href={l.href} className="link text-[15px]" rel="noreferrer">{l.label}</a></li>)}</ul>
          ) : <p className="hint">{SITE_CONTACT}</p>}
        </div>
      )}
    </AuthPage>
  );
}
