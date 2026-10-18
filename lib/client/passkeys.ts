import { startAuthentication, startRegistration, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";
import { postJson } from "./api";
import type { Me } from "./me";

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();
/** false on the server and during hydration, then the real answer. */
export const usePasskeySupport = () => useSyncExternalStore(() => () => {}, passkeysSupported, () => false);

/** Register this device. Throws an Error whose message is Spanish and ready to show. */
export async function registerPasskey(): Promise<void> {
  const optionsJSON = await postJson<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/me/passkeys/register/options", {});
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (e) {
    if ((e as Error).name === "NotAllowedError" || (e as Error).name === "AbortError") throw new Error("Has cancelado la activación.");
    if ((e as Error).name === "InvalidStateError") throw new Error("Este dispositivo ya está registrado.");
    throw new Error("Tu dispositivo no ha podido crear la clave. Inténtalo de nuevo.");
  }
  await postJson("/api/me/passkeys/register/verify", { response });
}

/** Sign in with a passkey. `auto` = browser autofill (conditional UI). Resolves with the user, or null if cancelled. */
export async function signInWithPasskey(auto = false, signal?: AbortSignal): Promise<Me | null> {
  const optionsJSON = await postJson<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/me/passkeys/login/options", {});
  let response;
  try {
    response = await startAuthentication({ optionsJSON, useBrowserAutofill: auto });
  } catch (e) {
    if (signal?.aborted) return null;
    if ((e as Error).name === "NotAllowedError" || (e as Error).name === "AbortError") return null;
    throw new Error("No se ha podido usar Face ID o huella en este dispositivo.");
  }
  const r = await postJson<{ user: Me }>("/api/me/passkeys/login/verify", { response });
  return r.user;
}
export const autofillSupported = () => browserSupportsWebAuthnAutofill();
