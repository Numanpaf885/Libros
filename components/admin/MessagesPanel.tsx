"use client";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import type { MessageRecord, MessageStatus } from "@/lib/types";

type Msg = Omit<MessageRecord, "ip_hash">;
interface ListResponse { available: boolean; unread: number; total: number; page: number; pages: number; size: number; rows: Msg[] }

const STATUS: Record<MessageStatus, [string, string]> = {
  nuevo: ["chip chip-busy", "Nuevo"],
  "leído": ["chip chip-draft", "Leído"],
  respondido: ["chip chip-ok", "Respondido"],
  archivado: ["chip chip-draft", "Archivado"],
};
const FILTERS: [string, string][] = [["", "Todos"], ["nuevo", "Nuevos"], ["leído", "Leídos"], ["respondido", "Respondidos"], ["archivado", "Archivados"]];
const hasEmail = (m: Msg) => m.email.includes("@");
/** "Responder por email": opens the admin's own email app with "Re: {asunto}" and the message quoted. */
function mailto(m: Msg): string {
  const quoted = m.message.split("\n").map((l) => `> ${l}`).join("\n");
  const body = `\n\n\n${fmtDateTime(m.created_at)}, ${m.name} escribió:\n${quoted}`;
  return `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}&body=${encodeURIComponent(body)}`;
}

function Detail({ m, onChange, onDelete }: { m: Msg; onChange: (patch: { status?: MessageStatus; admin_note?: string }) => Promise<void>; onDelete: () => Promise<void> }) {
  const toast = useToast();
  const [note, setNote] = useState(m.admin_note);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast("error", errText(e)); } setBusy(false); };
  return (
    <div className="mt-3 space-y-4 border-t border-line pt-4" data-testid="message-detail">
      <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted">De</dt><dd className="[overflow-wrap:anywhere]">{m.name} · {m.email}</dd>
        <dt className="text-muted">Cuenta</dt><dd className="[overflow-wrap:anywhere]">{m.username ? `@${m.username}` : "Sin cuenta"}</dd>
        <dt className="text-muted">Recibido</dt><dd className="tnum">{fmtDateTime(m.created_at)}</dd>
        {m.replied_at && <><dt className="text-muted">Respondido</dt><dd className="tnum">{fmtDateTime(m.replied_at)}</dd></>}
      </dl>
      {/* plain text only: React escapes everything, nothing is ever read as HTML */}
      <p className="panel whitespace-pre-wrap p-4 text-[15px] leading-7 [overflow-wrap:anywhere]" data-testid="message-text">{m.message}</p>
      <div className="flex flex-wrap gap-2">
        {hasEmail(m) && <a href={mailto(m)} className="btn btn-sm btn-primary" data-testid="message-mailto"><Icon name="arrow" size={16} />Responder por email</a>}
        {hasEmail(m) && (
          <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(m.email).then(() => toast("ok", "Email copiado"), () => toast("error", "No se pudo copiar. Selecciona el email y cópialo a mano."))}><Icon name="copy" size={16} />Copiar email</button>
        )}
        {m.status !== "respondido" && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => onChange({ status: "respondido" }))}>Marcar como respondido</button>}
        {m.status !== "archivado" && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => onChange({ status: "archivado" }))}>Archivar</button>}
        <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setAsk(true)}>Eliminar</button>
      </div>
      <div className="max-w-2xl">
        <label htmlFor={`note-${m.id}`} className="label">Nota privada <span className="font-normal text-muted">(solo la ves tú)</span></label>
        <textarea id={`note-${m.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="field" />
        <button type="button" className="btn btn-sm mt-2" disabled={busy || note === m.admin_note} onClick={() => run(async () => { await onChange({ admin_note: note }); toast("ok", "Nota guardada"); })}>Guardar nota</button>
      </div>
      <ConfirmDialog open={ask} danger title="Eliminar mensaje" confirmLabel="Eliminar para siempre" busy={busy} onCancel={() => setAsk(false)}
        onConfirm={() => run(async () => { await onDelete(); setAsk(false); })}>
        <p>Se borrará el mensaje de {m.name} de forma permanente.</p>
      </ConfirmDialog>
    </div>
  );
}

/** "Mensajes": the contact form's messages, newest first. Opening one marks it as read. */
export default function MessagesPanel({ onUnread }: { onUnread: (n: number) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let dead = false;
    const p = new URLSearchParams({ page: String(page) });
    if (status) p.set("status", status);
    if (term) p.set("q", term);
    api<ListResponse>(`/api/admin/messages?${p}`)
      .then((r) => { if (dead) return; setData(r); setFailed(""); })
      .catch((e) => { if (!dead) setFailed(errText(e)); });
    return () => { dead = true; };
  }, [status, term, page, version]);
  // the badge in the admin navigation follows this list
  const unread = data?.unread;
  useEffect(() => { if (unread !== undefined) onUnread(unread); }, [unread, onUnread]);

  const patch = useCallback(async (id: string, body: { status?: MessageStatus; admin_note?: string }) => {
    const r = await api<{ message: Msg }>(`/api/admin/messages/${id}`, "PATCH", body);
    setData((d) => {
      if (!d) return d;
      const was = d.rows.find((x) => x.id === id);
      const unread = d.unread - (was?.status === "nuevo" && r.message.status !== "nuevo" ? 1 : 0);
      return { ...d, unread, rows: d.rows.map((x) => (x.id === id ? r.message : x)) };
    });
  }, []);
  const toggle = (m: Msg) => {
    const next = open === m.id ? null : m.id;
    setOpen(next);
    if (next && m.status === "nuevo") patch(m.id, { status: "leído" }).catch((e) => toast("error", errText(e)));
  };

  if (failed) return <ErrorState title="No se han podido cargar los mensajes" text={failed} onRetry={() => { setFailed(""); setVersion((v) => v + 1); }} />;
  if (data && !data.available) return <div className="card p-6"><p className="text-[17px]" data-testid="messages-missing">Actualiza la base de datos en Mantenimiento.</p><p className="hint mt-1">Los mensajes del formulario de contacto necesitan la pestaña «messages» en la hoja de cálculo.</p></div>;

  return (
    <section aria-labelledby="msg-title" className="space-y-4" data-testid="messages-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="msg-title" className="text-2xl">Mensajes</h2>
          <p className="hint mt-1">Lo que llega desde el formulario de <a href="/contacto" className="underline underline-offset-4">Contacto</a>. Responde desde tu propio correo.</p>
        </div>
        {data && <p className="tnum text-sm text-muted" aria-live="polite">{data.total} {data.total === 1 ? "mensaje" : "mensajes"} · {data.unread} sin leer</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="w-full sm:w-48">
          <label htmlFor="msg-status" className="label">Estado</label>
          <select id="msg-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setOpen(null); }} className="field">
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="msg-q" className="label">Buscar</label>
          <input id="msg-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, email o texto" className="field" />
        </div>
      </div>
      {!data ? (
        <div className="space-y-3" aria-label="Cargando"><div className="skeleton h-20 rounded-card" /><div className="skeleton h-20 rounded-card" /></div>
      ) : data.rows.length === 0 ? (
        <div className="card px-6 py-10 text-center"><p className="text-[17px]">{term || status ? "Ningún mensaje coincide." : "Todavía no hay mensajes."}</p></div>
      ) : (
        <ul className="space-y-3" data-testid="messages-list">
          {data.rows.map((m) => {
            const [chip, label] = STATUS[m.status];
            return (
              <li key={m.id} className={`card p-4 ${m.status === "nuevo" ? "border-accent" : ""}`} data-id={m.id} data-status={m.status}>
                <button type="button" className="flex w-full flex-col gap-1 text-left" aria-expanded={open === m.id} onClick={() => toggle(m)}>
                  <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`${chip} w-fit`}>{label}</span>
                    <span className={`min-w-0 [overflow-wrap:anywhere] ${m.status === "nuevo" ? "font-semibold" : ""}`}>{m.name}</span>
                    <span className="min-w-0 text-sm text-muted [overflow-wrap:anywhere]">{m.email}</span>
                    <span className="tnum ml-auto text-sm text-muted">{fmtDateTime(m.created_at)}</span>
                  </span>
                  <span className="text-[15px] font-medium">{m.subject}</span>
                  {open !== m.id && <span className="line-clamp-2 text-[15px] text-muted [overflow-wrap:anywhere]">{m.message}</span>}
                </button>
                {open === m.id && (
                  <Detail key={`${m.id}:${m.admin_note}`} m={m} onChange={(b) => patch(m.id, b)}
                    onDelete={async () => { await api(`/api/admin/messages/${m.id}`, "DELETE"); toast("ok", "Mensaje eliminado"); setOpen(null); setVersion((v) => v + 1); }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.pages > 1 && (
        <nav aria-label="Páginas de mensajes" className="flex items-center justify-center gap-3">
          <button type="button" className="btn btn-sm" disabled={data.page <= 1} onClick={() => { setPage(data.page - 1); setOpen(null); }}>Anterior</button>
          <span className="tnum text-sm text-muted">Página {data.page} de {data.pages}</span>
          <button type="button" className="btn btn-sm" disabled={data.page >= data.pages} onClick={() => { setPage(data.page + 1); setOpen(null); }}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}
