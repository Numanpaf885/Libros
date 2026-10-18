import { useEffect, useSyncExternalStore } from "react";

export interface Me { id: string; username: string; display_name: string; passkeys: number }
interface State { status: "idle" | "loading" | "ready"; user: Me | null }

let state: State = { status: "idle", user: null };
const listeners = new Set<() => void>();
const set = (next: State) => { state = next; listeners.forEach((l) => l()); };

/** Ask the server who is signed in (also renews the cookie). Safe to call often. */
export async function refreshMe(): Promise<Me | null> {
  if (state.status === "idle") set({ ...state, status: "loading" });
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = res.ok ? ((await res.json()) as { user: Me | null }) : { user: null };
    set({ status: "ready", user: data.user });
    return data.user;
  } catch {
    set({ status: "ready", user: state.user });
    return state.user;
  }
}
export function setMe(user: Me | null) { set({ status: "ready", user }); }
export const getMe = () => state.user;

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const SERVER: State = { status: "idle", user: null };
export function useMe(): State {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  useEffect(() => { if (state.status === "idle") void refreshMe(); }, []);
  return s;
}
