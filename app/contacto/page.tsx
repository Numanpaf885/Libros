import AuthPage from "@/components/account/AuthPage";
import ContactForm from "@/components/contact/ContactForm";
import { formToken } from "@/lib/contact-server";
import { messagesAvailable } from "@/lib/db/users";
import { SITE_CONTACT, SITE_LINKS } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacto" };

export default async function ContactoPage() {
  const available = await messagesAvailable().catch(() => false);
  return (
    <AuthPage wide>
      {available ? <ContactForm token={formToken()} /> : (
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
