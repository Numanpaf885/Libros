"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { useMe } from "@/lib/client/me";
import { LIMITS, SUBJECTS } from "@/lib/contact";

type Field = "name" | "email" | "subject" | "message" | "consent";
const net = "No se ha podido enviar el mensaje. Comprueba tu conexión y vuelve a intentarlo.";

/** The contact form. What is typed is kept on every error; signed-in readers get their name filled in. */
export default function ContactForm({ token }: { token: string }) {
  const me = useMe();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const touchedName = useRef(false);
  const website = useRef<HTMLInputElement>(null);
  useEffect(() => { if (me.user && !touchedName.current) setName(me.user.display_name); }, [me.user]);

  const len = message.trim().length;
  const counterCls = len > LIMITS.messageMax || (len > 0 && len < LIMITS.messageMin) ? "text-danger" : "text-muted";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) { setError({ text: "Para enviar el mensaje tienes que aceptar la Política de privacidad.", field: "consent" }); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message, consent, website: website.current?.value ?? "", t: token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: Field; email?: string };
      if (res.ok) { setSent(data.email ?? email.trim()); window.scrollTo({ top: 0 }); }
      else setError({ text: data.error ?? net, field: data.field });
    } catch { setError({ text: net }); }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="card space-y-4 p-6 sm:p-8" role="status" data-testid="contact-sent">
        <Icon name="check" size={32} className="text-ok" />
        <h1 className="text-4xl">Mensaje enviado</h1>
        <p className="text-[17px]">Mensaje enviado. Te responderemos a <strong className="[overflow-wrap:anywhere]">{sent}</strong>.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn btn-primary min-h-11">Volver al catálogo</Link>
          <button type="button" className="btn min-h-11" onClick={() => { setSent(null); setMessage(""); setConsent(false); }}>Escribir otro mensaje</button>
        </div>
      </div>
    );
  }
  const bad = (f: Field) => error?.field === f;
  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8" noValidate data-testid="contact-form">
      <div>
        <h1 className="text-4xl">Contacto</h1>
        <p className="hint mt-1">¿Necesitas acceso a un libro, tienes un problema o una sugerencia? Escríbenos y te responderemos por email.</p>
        {me.user && <p className="hint mt-2" data-testid="contact-account">Se enviará vinculado a tu cuenta <strong className="font-medium text-fg [overflow-wrap:anywhere]">{me.user.username}</strong>.</p>}
      </div>
      <div>
        <label htmlFor="c-name" className="label">Nombre</label>
        <input id="c-name" name="name" autoComplete="name" required maxLength={LIMITS.name} value={name} onChange={(e) => { touchedName.current = true; setName(e.target.value); }} aria-invalid={bad("name")} className="field" />
      </div>
      <div>
        <label htmlFor="c-email" className="label">Email</label>
        <input id="c-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={LIMITS.email} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={bad("email")} className="field" />
      </div>
      <div>
        <label htmlFor="c-subject" className="label">Asunto</label>
        <select id="c-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={bad("subject")} className="field">
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="c-message" className="label">Mensaje</label>
        <textarea id="c-message" name="message" required rows={6} maxLength={LIMITS.messageMax} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={bad("message")} aria-describedby="c-count" className="field" />
        <p id="c-count" className={`tnum mt-1 text-right text-sm ${counterCls}`} aria-live="polite" data-testid="contact-count">{len} / {LIMITS.messageMax}{len > 0 && len < LIMITS.messageMin ? ` · mínimo ${LIMITS.messageMin}` : ""}</p>
      </div>
      {/* Honeypot: hidden from people (and from screen readers); only bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="c-website">Sitio web</label>
        <input ref={website} id="c-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <label className="flex min-h-11 items-start gap-3 text-[15px]">
        <input type="checkbox" name="consent" required checked={consent} onChange={(e) => { setConsent(e.target.checked); if (e.target.checked && error?.field === "consent") setError(null); }} aria-invalid={bad("consent")} className="mt-1 h-5 w-5 shrink-0" />
        <span>He leído y acepto la <Link href="/privacidad" target="_blank" className="link">Política de privacidad</Link></span>
      </label>
      {error && <p role="alert" className="err" data-testid="contact-error">{error.text}</p>}
      <button aria-busy={busy} disabled={busy} className="btn btn-primary min-h-11">Enviar mensaje</button>
      <p className="hint">Usamos tus datos solo para responderte. Más información en la <Link href="/privacidad" className="underline underline-offset-4">Política de privacidad</Link>.</p>
    </form>
  );
}
