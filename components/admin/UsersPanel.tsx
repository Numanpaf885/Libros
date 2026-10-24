"use client";
import { labelOf, labelTotal, parseLabels } from "@/lib/page-labels";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import type { AdminBook } from "@/lib/types";
import { DownloadHistory } from "./DownloadsPanel";

/** "Página 45 de 352" in the book's printed numbers when it has them (storage keeps the file page). */
function progressText(p: { page: number; page_count: number; page_labels?: string }) {
  const r = parseLabels(p.page_labels, p.page_count);
  return r.length ? `Página ${labelOf(r, p.page) || p.page} de ${labelTotal(r, p.page_count)}` : `Página ${p.page} de ${p.page_count}`;
}

interface UserView {
  id: string; username: string; display_name: string; status: "pending" | "active" | "disabled";
  created_at: string; last_login_at: string; code_expires_at: string;
  all_books: boolean; assigned: string[]; via_code: string[];
  progress: { book_id: string; title: string; page: number; page_count: number; updated_at: string; page_labels?: string }[];
  passkeys: number;
  can_download: boolean;
}
interface IssuedCode { username: string; display_name: string; code: string; expires_at: string }

const STATUS: Record<UserView["status"], [string, string]> = {
  pending: ["chip chip-busy", "Pendiente de activar"],
  active: ["chip chip-ok", "Activo"],
  disabled: ["chip chip-draft", "Desactivado"],
};
type Choice = { all: boolean; ids: string[] };

function BookChooser({ books, value, onChange, idPrefix }: { books: AdminBook[]; value: Choice; onChange: (c: Choice) => void; idPrefix: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="label">Libros</legend>
      <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`${idPrefix}-scope`} checked={value.all} onChange={() => onChange({ ...value, all: true })} />Todos los libros</label>
      <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`${idPrefix}-scope`} checked={!value.all} onChange={() => onChange({ ...value, all: false })} />Libros concretos</label>
      {!value.all && (
        <ul className="ml-1 max-h-56 space-y-1 overflow-auto rounded-card border border-line p-2">
          {books.length === 0 && <li className="hint p-2">Todavía no hay libros.</li>}
          {books.map((b) => (
            <li key={b.id}>
              <label className="flex min-h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" checked={value.ids.includes(b.id)} onChange={(e) => onChange({ ...value, ids: e.target.checked ? [...value.ids, b.id] : value.ids.filter((x) => x !== b.id) })} />
                <span className="min-w-0 truncate">{b.title}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function CodeCard({ issued, onClose, heading }: { issued: IssuedCode; onClose: () => void; heading: string }) {
  const toast = useToast();
  const copy = (text: string, ok: string) => navigator.clipboard.writeText(text).then(() => toast("ok", ok), () => toast("error", "No se pudo copiar. Selecciona el texto y cópialo a mano."));
  const url = typeof window === "undefined" ? "" : window.location.origin;
  const message = `Hola ${issued.display_name}, tu usuario en Libros es ${issued.username} y tu código de activación es ${issued.code}. Actívalo aquí: ${url}/activar (caduca en 72 horas).`;
  return (
    <div className="card space-y-4 border-accent p-5" role="region" aria-label="Código de activación">
      <div>
        <h3 className="text-2xl">{heading}</h3>
        <p className="hint mt-1">Se muestra una sola vez: si lo pierdes, tendrás que restablecer la contraseña para generar otro. Caduca el {fmtDate(issued.expires_at)} (72 horas) y se anula tras 5 intentos fallidos.</p>
      </div>
      <p className="select-all break-all rounded-card bg-surface p-4 text-center font-mono text-2xl tracking-[0.15em]" data-testid="setup-code">{issued.code}</p>
      <p className="text-[15px] text-muted">Usuario: <span className="font-mono text-fg">{issued.username}</span></p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary min-h-11" onClick={() => copy(issued.code, "Código copiado")}><Icon name="copy" size={18} />Copiar código</button>
        <button className="btn min-h-11" onClick={() => copy(message, "Mensaje copiado")}><Icon name="copy" size={18} />Copiar mensaje de WhatsApp</button>
        <button className="btn min-h-11 border-transparent" onClick={onClose}>Hecho</button>
      </div>
    </div>
  );
}

function UserRow({ u, books, reload, issue, dl }: { u: UserView; books: AdminBook[]; reload: () => void; issue: (c: IssuedCode, heading: string) => void; dl: boolean }) {
  const toast = useToast();
  const [panel, setPanel] = useState<"books" | "history" | null>(null);
  const [choice, setChoice] = useState<Choice>({ all: u.all_books, ids: u.assigned });
  const [busy, setBusy] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [anon, setAnon] = useState(false);
  const title = (id: string) => books.find((b) => b.id === id)?.title ?? "Libro eliminado";
  const [chipClass, chipText] = STATUS[u.status];
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast("error", errText(e)); }
    setBusy(false);
  };

  return (
    <li className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-2xl font-semibold leading-tight">{u.display_name}</h3>
          <p className="truncate font-mono text-sm text-muted">{u.username}</p>
        </div>
        <span className={chipClass}>{chipText}</span>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-3 text-[15px] sm:grid-cols-2">
        <div><dt className="text-sm text-muted">Último acceso</dt><dd className="tnum">{u.last_login_at ? fmtDate(u.last_login_at) : "Nunca"}</dd></div>
        <div><dt className="text-sm text-muted">Face ID o huella</dt><dd>{u.passkeys ? `${u.passkeys} ${u.passkeys === 1 ? "dispositivo" : "dispositivos"}` : "No activado"}</dd></div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted">Libros asignados</dt>
          <dd>{u.all_books ? "Todos los libros" : u.assigned.length ? u.assigned.map(title).join(" · ") : "Ninguno"}{u.via_code.length > 0 && <span className="text-muted"> · con código: {u.via_code.map(title).join(" · ")}</span>}</dd>
        </div>
        {dl && (
          <div className="sm:col-span-2">
            <label className="flex min-h-11 w-fit items-center gap-3 text-[15px]">
              <input type="checkbox" role="switch" className="h-5 w-5" checked={u.can_download} disabled={busy} aria-label={`Puede descargar PDF: ${u.display_name}`}
                onChange={(e) => run(async () => { await api(`/api/admin/users/${u.id}`, "PATCH", { can_download: e.target.checked }); toast("ok", e.target.checked ? "Ahora puede descargar PDF" : "Ya no puede descargar PDF"); reload(); })} />
              Puede descargar PDF
            </label>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted">Progreso de lectura</dt>
          <dd>
            {u.progress.length === 0 ? <span className="text-muted">Sin lecturas todavía</span> : (
              <ul className="space-y-0.5">{u.progress.map((p) => <li key={p.book_id} className="tnum">{p.title}: {progressText(p)}</li>)}</ul>
            )}
          </dd>
        </div>
        {u.status === "pending" && (
          <div className="sm:col-span-2"><dt className="text-sm text-muted">Código de activación</dt><dd>{u.code_expires_at ? `Válido hasta el ${fmtDate(u.code_expires_at)}` : "Caducado o anulado: restablece la contraseña para generar otro."}</dd></div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => { setChoice({ all: u.all_books, ids: u.assigned }); setPanel(panel === "books" ? null : "books"); }}>Editar libros</button>
        {dl && <button className="btn btn-sm" onClick={() => setPanel(panel === "history" ? null : "history")}>Historial de descargas</button>}
        <button className="btn btn-sm" onClick={() => setAskReset(true)}>Restablecer contraseña</button>
        {u.status !== "pending" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => { await api(`/api/admin/users/${u.id}`, "PATCH", { disabled: u.status === "active" }); toast("ok", u.status === "active" ? "Usuario desactivado" : "Usuario activado"); reload(); })}>
            {u.status === "active" ? "Desactivar" : "Activar"}
          </button>
        )}
        <a className="btn btn-sm" href={`/api/admin/users/${u.id}/export`} download data-testid="export-user"><Icon name="download" size={16} />Exportar datos</a>
        <button className="btn btn-sm btn-danger" onClick={() => { setConfirm(""); setAnon(false); setAskDelete(true); }}>Eliminar</button>
      </div>

      {panel === "history" && <div className="mt-4 border-t border-line pt-4"><DownloadHistory filter={{ user: u.id }} /></div>}

      {panel === "books" && (
        <form className="mt-4 max-w-md space-y-3 border-t border-line pt-4" onSubmit={(e) => {
          e.preventDefault();
          run(async () => { await api(`/api/admin/users/${u.id}`, "PATCH", { books: choice.all ? "all" : choice.ids }); toast("ok", "Libros actualizados"); setPanel(null); reload(); });
        }}>
          <BookChooser books={books} value={choice} onChange={setChoice} idPrefix={`e-${u.id}`} />
          <button disabled={busy} className="btn btn-primary min-h-11">Guardar libros</button>
        </form>
      )}

      <ConfirmDialog open={askReset} title="Restablecer contraseña" confirmLabel="Restablecer" busy={busy} onCancel={() => setAskReset(false)}
        onConfirm={() => run(async () => {
          const r = await api<IssuedCode>(`/api/admin/users/${u.id}/reset`, "POST", {});
          setAskReset(false); issue(r, "Nuevo código de activación"); reload();
        })}>
        <p>Se borrarán la contraseña y los dispositivos de Face ID o huella de <strong className="text-fg">{u.display_name}</strong>, se cerrará su sesión en todos los dispositivos y recibirá un código nuevo para volver a activar su cuenta.</p>
      </ConfirmDialog>
      <ConfirmDialog open={askDelete} danger title="Eliminar usuario" confirmLabel="Eliminar para siempre" busy={busy} confirmDisabled={confirm.trim().toLowerCase() !== u.username} onCancel={() => setAskDelete(false)}
        onConfirm={() => run(async () => {
          // first the history (by id), so a failure leaves the account in place and the admin can try again
          if (anon) await api(`/api/admin/users/${u.id}/anonymize`, "POST", {});
          await api(`/api/admin/users/${u.id}`, "DELETE", { username: confirm });
          setAskDelete(false); toast("ok", anon ? "Usuario eliminado y su historial anonimizado" : "Usuario eliminado"); reload();
        })}>
        <p>Se borrarán su cuenta, su progreso y sus dispositivos. Escribe <strong className="text-fg">{u.username}</strong> para confirmar.</p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" aria-label="Escribe el nombre de usuario para confirmar" autoComplete="off" autoCapitalize="none" />
        <label className="flex min-h-11 items-start gap-3 pt-2 text-[15px] text-fg">
          <input type="checkbox" className="mt-1" checked={anon} onChange={(e) => setAnon(e.target.checked)} data-testid="delete-anon" />
          <span>Anonimizar también su historial de descargas y mensajes <span className="block text-sm text-muted">Su nombre, usuario y email pasan a ser «Usuario eliminado».</span></span>
        </label>
      </ConfirmDialog>
    </li>
  );
}

export default function UsersPanel({ books }: { books: AdminBook[] }) {
  const toast = useToast();
  const [users, setUsers] = useState<UserView[] | null>(null);
  const [dl, setDl] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [issued, setIssued] = useState<{ code: IssuedCode; heading: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [display, setDisplay] = useState("");
  const [choice, setChoice] = useState<Choice>({ all: true, ids: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    api<{ users: UserView[]; downloads_available?: boolean }>("/api/admin/users").then((r) => { if (!dead) { setUsers(r.users); setDl(!!r.downloads_available); } }).catch((e) => { if (!dead) toast("error", errText(e)); });
    return () => { dead = true; };
  }, [version, toast]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api<IssuedCode>("/api/admin/users", "POST", { username, display_name: display, books: choice.all ? "all" : choice.ids });
      setIssued({ code: r, heading: `Usuario creado: ${r.display_name}` });
      setUsername(""); setDisplay(""); setChoice({ all: true, ids: [] });
      reload();
    } catch (err) { setError(errText(err)); }
    setBusy(false);
  }

  return (
    <div className="space-y-8">
      {issued && <CodeCard issued={issued.code} heading={issued.heading} onClose={() => setIssued(null)} />}

      <form onSubmit={create} className="card space-y-5 p-5 sm:p-7">
        <h2 className="text-2xl">Crear un usuario</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="nu-user" className="label">Usuario</label>
            <input id="nu-user" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required minLength={3} maxLength={32} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby="nu-user-hint" className="field font-mono" />
            <p id="nu-user-hint" className="hint mt-1">Minúsculas, números, punto, guion o guion bajo.</p>
          </div>
          <div>
            <label htmlFor="nu-name" className="label">Nombre</label>
            <input id="nu-name" value={display} onChange={(e) => setDisplay(e.target.value)} required maxLength={60} autoComplete="off" className="field" />
          </div>
        </div>
        <BookChooser books={books} value={choice} onChange={setChoice} idPrefix="nu" />
        {error && <p role="alert" className="err">{error}</p>}
        <button aria-busy={busy} disabled={busy || !username || !display.trim() || (!choice.all && choice.ids.length === 0)} className="btn btn-primary min-h-11">Crear usuario y generar código</button>
      </form>

      {users === null ? (
        <div className="space-y-3" aria-label="Cargando"><div className="skeleton h-40 rounded-card" /></div>
      ) : users.length === 0 ? (
        <div className="card px-6 py-12 text-center"><h2 className="text-3xl">Todavía no hay usuarios</h2><p className="mt-2 text-muted">Crea el primero arriba y compárteles el código de activación.</p></div>
      ) : (
        <ul className="space-y-4" aria-label="Usuarios">
          {users.map((u) => <UserRow key={u.id} u={u} books={books} dl={dl} reload={reload} issue={(c, h) => setIssued({ code: c, heading: h })} />)}
        </ul>
      )}
    </div>
  );
}
