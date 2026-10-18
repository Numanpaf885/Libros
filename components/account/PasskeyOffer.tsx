"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { errText } from "@/lib/client/api";
import { setMe, type Me } from "@/lib/client/me";
import { registerPasskey } from "@/lib/client/passkeys";

const key = (userId: string) => `br:pk-offer:${userId}`;
/** The offer is made once per person and device: it is never shown again after "Ahora no" or after activating. */
export function shouldOffer(user: Me, supported: boolean): boolean {
  if (!supported || user.passkeys > 0) return false;
  try { return !localStorage.getItem(key(user.id)); } catch { return false; }
}
const markOffered = (userId: string) => { try { localStorage.setItem(key(userId), "1"); } catch { /* ignore */ } };

export default function PasskeyOffer({ user, onDone }: { user: Me; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function activate() {
    setBusy(true); setError("");
    try {
      await registerPasskey();
      markOffered(user.id);
      setMe({ ...user, passkeys: user.passkeys + 1 });
      onDone();
    } catch (e) {
      setError(errText(e) === "Algo ha salido mal. Inténtalo de nuevo." && e instanceof Error ? e.message : errText(e));
      setBusy(false);
    }
  }
  return (
    <div className="card flex flex-col gap-5 p-6 sm:p-8" role="region" aria-labelledby="pk-title">
      <div>
        <Icon name="device" size={32} className="mb-3 text-accent" />
        <h1 id="pk-title" className="text-3xl">Activa el acceso con Face ID o huella</h1>
        <p className="hint mt-2">La próxima vez entrarás con un toque, sin escribir la contraseña. Tu huella o tu cara no salen de este dispositivo.</p>
      </div>
      {error && <p role="alert" className="err">{error}</p>}
      <div className="flex flex-col gap-2">
        <button aria-busy={busy} type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={activate}>Activar</button>
        <button type="button" className="btn min-h-11 border-transparent" disabled={busy} onClick={() => { markOffered(user.id); onDone(); }}>Ahora no</button>
      </div>
    </div>
  );
}
