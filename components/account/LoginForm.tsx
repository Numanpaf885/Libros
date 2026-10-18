"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { errText, postJson } from "@/lib/client/api";
import { refreshMe, setMe, type Me } from "@/lib/client/me";
import { autofillSupported, passkeysSupported, signInWithPasskey, usePasskeySupport } from "@/lib/client/passkeys";
import { mergeLocalProgress } from "@/lib/client/progress-sync";
import Icon from "@/components/ui/Icon";
import PasskeyOffer, { shouldOffer } from "./PasskeyOffer";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<Me | null>(null);
  const canPasskey = usePasskeySupport();
  const started = useRef(false);

  const leave = () => { router.replace(next); router.refresh(); };
  async function signedIn(user: Me) {
    setMe(user);
    await mergeLocalProgress();
    if (shouldOffer(user, passkeysSupported())) setOffer(user);
    else leave();
  }

  // Passkeys offered by the browser's own autofill list on the username field.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!passkeysSupported()) return;
    void (async () => {
      try {
        if (!(await autofillSupported())) return;
        const user = await signInWithPasskey(true);
        if (user) await signedIn(user);
      } catch { /* the explicit button reports errors */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await postJson<{ user: Me }>("/api/me/login", { username: f.get("username"), password: f.get("password") });
      await signedIn(r.user);
    } catch (err) { setError(errText(err)); }
    setBusy(false);
  }
  async function withPasskey() {
    setBusy(true); setError("");
    try {
      const user = await signInWithPasskey(false);
      if (user) await signedIn(user);
    } catch (err) { setError(err instanceof Error ? err.message : errText(err)); }
    setBusy(false);
  }
  useEffect(() => { void refreshMe(); }, []);

  if (offer) return <PasskeyOffer user={offer} onDone={leave} />;
  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8">
      <div>
        <Logo size={40} className="mb-3 text-accent" />
        <h1 className="text-4xl">Entrar</h1>
        <p className="hint mt-1">Con tu cuenta tus libros y tu página se guardan en todos tus dispositivos.</p>
      </div>
      <div>
        <label htmlFor="username" className="label">Usuario</label>
        <input id="username" name="username" autoComplete="username webauthn" autoCapitalize="none" spellCheck={false} required maxLength={64} className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} className="field" />
        {error && <p role="alert" className="err mt-2">{error}</p>}
      </div>
      <button disabled={busy} className="btn btn-primary min-h-11">{busy ? "Entrando…" : "Entrar"}</button>
      {canPasskey && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" /></div>
          <button type="button" className="btn min-h-11" disabled={busy} onClick={withPasskey}><Icon name="device" size={18} />Entrar con Face ID o huella</button>
        </>
      )}
      <div className="space-y-2 text-center text-[15px]">
        <p><Link href="/activar" className="underline underline-offset-4">¿Primera vez? Activa tu cuenta</Link></p>
        <p className="hint">¿Has olvidado tu contraseña? Pide al propietario un nuevo código.</p>
      </div>
    </form>
  );
}
