"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { errText, postJson } from "@/lib/client/api";
import { setMe, type Me } from "@/lib/client/me";
import { passkeysSupported } from "@/lib/client/passkeys";
import { mergeLocalProgress } from "@/lib/client/progress-sync";
import PasskeyOffer, { shouldOffer } from "./PasskeyOffer";
import StrengthMeter from "./StrengthMeter";

/** Shows what is typed as XXXX-XXXX-XXXX (the code has no look-alike characters). */
const formatTyped = (v: string) => (v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12).match(/.{1,4}/g) ?? []).join("-");

export default function ActivateForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<Me | null>(null);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const leave = () => { router.replace("/"); router.refresh(); };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pw !== pw2) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true); setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await postJson<{ user: Me }>("/api/me/activate", { username: f.get("username"), code, password: pw });
      setMe(r.user);
      await mergeLocalProgress();
      if (shouldOffer(r.user, passkeysSupported())) setOffer(r.user);
      else leave();
    } catch (err) { setError(errText(err)); }
    setBusy(false);
  }

  if (offer) return <PasskeyOffer user={offer} onDone={leave} />;
  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8" noValidate>
      <div>
        <Logo size={40} className="mb-3 text-accent" />
        <h1 className="text-4xl">Activa tu cuenta</h1>
        <p className="hint mt-1">Usa el usuario y el código de activación que te ha dado el propietario.</p>
      </div>
      <div>
        <label htmlFor="username" className="label">Usuario</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64} className="field" />
      </div>
      <div>
        <label htmlFor="code" className="label">Código de activación</label>
        <input id="code" name="code" value={code} onChange={(e) => setCode(formatTyped(e.target.value))} inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required maxLength={14} placeholder="XXXX-XXXX-XXXX" className="field font-mono uppercase tracking-[0.15em]" />
      </div>
      <div>
        <label htmlFor="new-password" className="label">Contraseña nueva</label>
        <input id="new-password" name="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required minLength={10} maxLength={72} className="field" aria-describedby="pw-hint" />
        <div id="pw-hint"><StrengthMeter password={pw} /></div>
      </div>
      <div>
        <label htmlFor="confirm-password" className="label">Repite la contraseña</label>
        <input id="confirm-password" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required maxLength={72} aria-invalid={mismatch} className="field" />
        {mismatch && <p className="err mt-2">Las contraseñas no coinciden.</p>}
      </div>
      {error && <p role="alert" className="err">{error}</p>}
      <button aria-busy={busy} disabled={busy || !code || pw.length < 10 || pw !== pw2} className="btn btn-primary min-h-11">Activar cuenta</button>
      <p className="text-center text-[15px]"><Link href="/entrar" className="underline underline-offset-4">¿Ya tienes cuenta? Entra</Link></p>
    </form>
  );
}
