// Single place for the site's public copy and contact links. Override with env vars.
export const SITE_NAME = process.env.SITE_NAME || "Libros";
/** One line of intro text (footer and metadata). SITE_TAGLINE is still read for older .env files. */
export const SITE_INTRO = process.env.SITE_INTRO || process.env.SITE_TAGLINE || "Libros para leer en cualquier dispositivo con tu código de acceso.";
export const SITE_CONTACT = process.env.SITE_CONTACT || "¿No tienes código? Pídeselo al autor.";

const clean = (v: string | undefined) => (v ?? "").trim();
const email = clean(process.env.SITE_EMAIL);
const instagram = clean(process.env.SITE_INSTAGRAM);
const whatsapp = clean(process.env.SITE_WHATSAPP);

/** Only the contact channels that are configured; empty ones are hidden. */
export const SITE_LINKS: { label: string; href: string }[] = [
  ...(email ? [{ label: "Correo", href: `mailto:${email}` }] : []),
  ...(instagram ? [{ label: "Instagram", href: /^https?:/.test(instagram) ? instagram : `https://instagram.com/${instagram.replace(/^@/, "")}` }] : []),
  ...(whatsapp ? [{ label: "WhatsApp", href: /^https?:/.test(whatsapp) ? whatsapp : `https://wa.me/${whatsapp.replace(/\D/g, "")}` }] : []),
];
