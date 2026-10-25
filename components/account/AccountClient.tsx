"use client";
import { labelOf, labelTotal, parseLabels } from "@/lib/page-labels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText, postJson } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { refreshMe, setMe } from "@/lib/client/me";
import { registerPasskey, usePasskeySupport } from "@/lib/client/passkeys";
import StrengthMeter from "./StrengthMeter";

/** "Página 45 de 352": the book's printed numbers when it has them. */
const pageText = (b: { page: number; page_count: number; page_labels?: string }) => {
  const r = parseLabels(b.page_labels, b.page_count);
  return r.length ? `Página ${labelOf(r, b.page) || b.page} de ${labelTotal(r, b.page_count)}` : `Página ${b.page} de ${b.page_count}`;
};
interface BookRow { slug: string; title: string; author: string; page_count: number; page: number; page_labels?: string }
interface PasskeyRow { id: string; label: string; created_at: string; last_used_at: string }

export default function AccountClient({ user }: { user: { username: string; display_name: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [booksErr, setBooksErr] = useState("");
  const [keys, setKeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [pwError, setPwError] = useState("");
  const [askAll, setAskAll] = useState(false);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const supported = usePasskeySupport();

  const loadKeys = useCallback(() => api<{ passkeys: PasskeyRow[] }>("/api/me/passkeys").then((r) => setKeys(r.passkeys)).catch(() => setKeys([])), []);
  const loadBooks = useCallback(() => api<{ books: BookRow[] }>("/api/me/books").then((r) => { setBooks(r.books); setBooksErr(""); }).catch((e) => setBooksErr(errText(e))), []);
  useEffect(() => {
    void refreshMe();
    void loadBooks();
    void loadKeys();
  }, [loadKeys, loadBooks]);

  const leave = () => { setMe(null); router.replace("/"); router.refresh(); };
  async function logout() { await postJson("/api/me/logout"); leave(); }
  async function logoutAll() {
    setBusy(true);
    try { await postJson("/api/me/logout-all"); leave(); } catch (e) { toast("error", errText(e)); setBusy(false); setAskAll(false); }
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== next2) { setPwError("Las contraseñas nuevas no coinciden."); return; }
    setBusy(true); setPwError("");
    try {
      await postJson("/api/me/password", { current: cur, next });
      setCur(""); setNext(""); setNext2("");
      toast("ok", "Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.");
    } catch (err) { setPwError(errText(err)); }
    setBusy(false);
  }
  async function addKey() {
    setBusy(true);
    try { await registerPasskey(); toast("ok", "Face ID o huella activado en este dispositivo"); await loadKeys(); void refreshMe(); }
    catch (e) { toast("error", e instanceof Error ? e.message : errText(e)); }
    setBusy(false);
  }
  async function removeKey(k: PasskeyRow) {
    setBusy(true);
    try { await postJson(`/api/me/passkeys/${k.id}`, {}, "DELETE"); toast("ok", "Dispositivo quitado"); await loadKeys(); void refreshMe(); }
    catch (e) { toast("error", errText(e)); }
    setBusy(false); setRemoving(null);
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl">Mi cuenta</h1>
          <p className="mt-1 truncate text-muted">{user.display_name} · <span className="font-mono text-[15px]">{user.username}</span></p>
        </div>
        <button className="btn" onClick={logout}>Salir</button>
      </header>

      <section aria-labelledby="mis-libros" className="card p-5 sm:p-6">
        <h2 id="mis-libros" className="text-2xl">Mis libros</h2>
        {books === null && booksErr ? (
          <ErrorState className="mt-4" title="No se han podido cargar tus libros" text={booksErr} onRetry={() => { setBooksErr(""); void loadBooks(); }} />
        ) : books === null ? (
          <div className="skeleton mt-4 h-20 rounded-card" aria-label="Cargando" />
        ) : books.length === 0 ? (
          <p className="hint mt-3">Todavía no tienes libros. Cuando el propietario te asigne alguno, o introduzcas un código de acceso, aparecerán aquí.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {books.map((b) => (
              <li key={b.slug} className="py-3 first:pt-0 last:pb-0">
                <Link href={b.page > 1 ? `/b/${b.slug}#p=${b.page}` : `/b/${b.slug}`} className="block rounded-ctl">
                  <p className="font-serif text-xl font-semibold leading-tight">{b.title}</p>
                  <p className="tnum text-sm text-muted">{b.page > 0 ? pageText(b) : `${b.page_count} páginas · sin empezar`}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label={`Progreso en ${b.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((b.page / b.page_count) * 100)}>
                    <div className="h-full bg-accent" style={{ width: `${(b.page / b.page_count) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="clave" className="card p-5 sm:p-6">
        <h2 id="clave" className="text-2xl">Face ID o huella</h2>
        <p className="hint mt-1">Entra con un toque desde los dispositivos que añadas.</p>
        {keys && keys.length > 0 && (
          <ul className="mt-4 divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon name="device" className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{k.label}</p>
                  <p className="tnum text-sm text-muted">Añadido el {fmtDate(k.created_at)}{k.last_used_at ? ` · usado el ${fmtDate(k.last_used_at)}` : ""}</p>
                </div>
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setRemoving(k)}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
        {supported ? (
          <button className="btn mt-4 min-h-11" disabled={busy} onClick={addKey}><Icon name="device" size={18} />Añadir este dispositivo</button>
        ) : (
          <p className="hint mt-4">Este navegador no admite Face ID ni huella.</p>
        )}
      </section>

      <section aria-labelledby="pw" className="card p-5 sm:p-6">
        <h2 id="pw" className="text-2xl">Cambiar contraseña</h2>
        <form onSubmit={changePassword} className="mt-4 grid max-w-sm gap-4">
          <input type="text" name="username" value={user.username} autoComplete="username" readOnly hidden aria-hidden="true" />
          <div><label htmlFor="cur" className="label">Contraseña actual</label><input id="cur" type="password" autoComplete="current-password" required maxLength={200} value={cur} onChange={(e) => setCur(e.target.value)} className="field" /></div>
          <div><label htmlFor="n1" className="label">Contraseña nueva</label><input id="n1" type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} className="field" /><StrengthMeter password={next} /></div>
          <div><label htmlFor="n2" className="label">Repite la contraseña nueva</label><input id="n2" type="password" autoComplete="new-password" required maxLength={72} value={next2} onChange={(e) => setNext2(e.target.value)} className="field" /></div>
          {pwError && <p role="alert" className="err">{pwError}</p>}
          <div><button disabled={busy || !cur || next.length < 10} className="btn btn-primary min-h-11">Cambiar contraseña</button></div>
        </form>
      </section>

      <section aria-labelledby="sesiones" className="card p-5 sm:p-6">
        <h2 id="sesiones" className="text-2xl">Sesiones</h2>
        <p className="hint mt-1">Si has perdido un dispositivo o usaste un ordenador ajeno, cierra la sesión en todos.</p>
        <button className="btn btn-danger mt-4 min-h-11" disabled={busy} onClick={() => setAskAll(true)}>Cerrar sesión en todos los dispositivos</button>
      </section>

      <ConfirmDialog open={askAll} danger title="Cerrar sesión en todos los dispositivos" confirmLabel="Cerrar todas las sesiones" busy={busy} onCancel={() => setAskAll(false)} onConfirm={logoutAll}>
        <p>Tendrás que volver a entrar en cada dispositivo, también en este.</p>
      </ConfirmDialog>
      <ConfirmDialog open={!!removing} danger title="Quitar dispositivo" confirmLabel="Quitar" busy={busy} onCancel={() => setRemoving(null)} onConfirm={() => removing && removeKey(removing)}>
        <p>«{removing?.label}» ya no podrá entrar con Face ID o huella. Seguirás pudiendo entrar con tu contraseña.</p>
      </ConfirmDialog>
    </div>
  );
}
