"use client";
import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { api, errText } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import type { AdminBook, AdminCode } from "@/lib/types";

interface Fresh { id: string; label: string; code: string; share_code: string }
type Mode = "random" | "custom";

export default function CodesPanel({ book, onBookChanged }: { book: AdminBook; onBookChanged: () => void }) {
  const toast = useToast();
  const [codes, setCodes] = useState<AdminCode[]>([]);
  const [fresh, setFresh] = useState<Fresh[]>([]);
  const [mode, setMode] = useState<Mode>("random");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState("");
  const [version, setVersion] = useState(0);
  const [now] = useState(() => Date.now());
  const [changing, setChanging] = useState<AdminCode | null>(null);
  const [newCode, setNewCode] = useState("");
  const [changeError, setChangeError] = useState("");
  const isDraft = book.status !== "published";
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let dead = false;
    api<{ codes: AdminCode[] }>(`/api/admin/books/${book.id}/codes`)
      .then((r) => { if (!dead) setCodes(r.codes); })
      .catch((e) => { if (!dead) toast("error", errText(e)); });
    return () => { dead = true; };
  }, [book.id, version, toast]);

  // Always the address the admin is on right now (localhost:3000 locally, the live domain in production).
  const link = (c: Fresh) => `${window.location.origin}/b/${book.slug}?code=${encodeURIComponent(c.share_code)}`;
  async function copy(text: string, key: string, link = false) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
      if (link && isDraft) toast("error", "Enlace copiado, pero los lectores no podrán abrirlo hasta que publiques el libro.");
      else toast("ok", link ? "Enlace copiado" : "Código copiado");
    } catch {
      toast("error", "No se pudo copiar");
    }
  }

  async function publish() {
    try {
      await api(`/api/admin/books/${book.id}`, "PATCH", { status: "published" });
      toast("ok", "Libro publicado");
      onBookChanged();
    } catch (e) { toast("error", errText(e)); }
  }

  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const exp = String(f.get("expires") ?? "");
    const expires_at = exp ? new Date(exp + "T23:59:59").toISOString() : null;
    setBusy(true); setFormError("");
    try {
      let payload: Record<string, unknown>;
      if (mode === "custom") {
        const custom = String(f.get("custom") ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = /^(\S+?)[\s,;]+(.+)$/.exec(l);
          return m ? { code: m[1], label: m[2].trim() } : { code: l, label: "" };
        });
        if (!custom.length) { setFormError("Escribe al menos un código."); setBusy(false); return; }
        payload = { custom, expires_at };
      } else {
        const labels = String(f.get("labels") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
        payload = { count: labels.length || Number(f.get("count")) || 1, labels, expires_at };
      }
      const res = await api<{ codes: Fresh[] }>(`/api/admin/books/${book.id}/codes`, "POST", payload);
      setFresh(res.codes);
      toast("ok", res.codes.length === 1 ? "Código creado" : `${res.codes.length} códigos creados`);
      reload();
    } catch (e2) { setFormError(errText(e2)); }
    setBusy(false);
  }

  async function doChange(random: boolean) {
    if (!changing) return;
    setBusy(true); setChangeError("");
    try {
      const res = await api<{ code: Fresh }>(`/api/admin/books/${book.id}/codes/${changing.id}/change`, "POST", random ? {} : { code: newCode });
      setFresh([res.code]);
      setChanging(null); setNewCode("");
      toast("ok", "Código cambiado. El anterior ya no funciona.");
      reload();
    } catch (e) { setChangeError(errText(e)); }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      {isDraft && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent bg-accent/10 p-4">
          <p className="max-w-prose text-[15px]"><strong>Este libro es un borrador.</strong> Los lectores no podrán abrirlo, aunque tengan un código, hasta que lo publiques.</p>
          <button className="btn btn-primary" onClick={publish}>Publicar</button>
        </div>
      )}

      <form onSubmit={generate} className="space-y-4">
        <div role="tablist" aria-label="Tipo de código" className="inline-flex rounded-ctl border border-line-strong p-1">
          {([["random", "Aleatorios"], ["custom", "Los elijo yo"]] as const).map(([m, text]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setFormError(""); }}
              className={`min-h-9 rounded-[3px] px-4 text-sm font-medium transition-colors ${mode === m ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}>{text}</button>
          ))}
        </div>
        {mode === "random" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`labels-${book.id}`} className="label">Etiquetas (una por línea)</label>
              <textarea id={`labels-${book.id}`} name="labels" rows={3} placeholder={"Amina\nLucas"} className="field" />
              <p className="hint mt-1">Cada línea crea un código. Déjalo vacío para elegir cuántos.</p>
            </div>
            <div>
              <label htmlFor={`count-${book.id}`} className="label">Cantidad</label>
              <input id={`count-${book.id}`} name="count" type="number" min={1} max={100} defaultValue={1} className="field" />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor={`custom-${book.id}`} className="label">Tus códigos (uno por línea)</label>
            <textarea id={`custom-${book.id}`} name="custom" rows={3} placeholder={"AMINA2026, Amina\nLUCAS-2026"} className="field font-mono" spellCheck={false} />
            <p className="hint mt-1">De 6 a 32 caracteres: letras, números y guiones. No distingue mayúsculas. Añade una etiqueta tras una coma si quieres.</p>
          </div>
        )}
        <div className="max-w-xs">
          <label htmlFor={`exp-${book.id}`} className="label">Caduca (opcional)</label>
          <input id={`exp-${book.id}`} name="expires" type="date" className="field" />
        </div>
        {formError && <p role="alert" className="err">{formError}</p>}
        <button disabled={busy} className="btn btn-primary">{busy ? "Creando…" : mode === "custom" ? "Crear mis códigos" : "Generar códigos"}</button>
      </form>

      {fresh.length > 0 && (
        <div className="space-y-3 rounded-card border border-accent bg-accent/10 p-4">
          <p className="text-[15px]">Cópialos ahora. Solo guardamos una huella del código, así que no se podrá volver a mostrar.</p>
          <ul className="space-y-3">
            {fresh.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-20 font-medium">{c.label}</span>
                <code className="rounded-md border border-line-strong bg-bg px-2.5 py-1 font-mono text-[15px] tracking-wider">{c.code}</code>
                <button className="btn btn-sm" onClick={() => copy(c.code, c.id + "c")}><Icon name={copied === c.id + "c" ? "check" : "copy"} size={16} />Copiar código</button>
                <button className="btn btn-sm" onClick={() => copy(link(c), c.id + "l", true)}><Icon name={copied === c.id + "l" ? "check" : "link"} size={16} />Copiar enlace</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-line">
        {codes.length === 0 && <li className="py-3 text-muted">Todavía no hay códigos.</li>}
        {codes.map((c) => {
          const expired = !!c.expires_at && Date.parse(c.expires_at) <= now;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className={`ml-2 text-sm ${c.revoked || expired ? "text-danger" : "text-muted"}`}>
                  {c.revoked ? "Revocado" : expired ? "Caducado" : c.expires_at ? `Caduca el ${fmtDate(c.expires_at)}` : "Sin caducidad"}
                </span>
              </div>
              <div className="flex gap-2">
                {!c.revoked && <button className="btn btn-sm" onClick={() => { setChanging(c); setNewCode(""); setChangeError(""); }}>Cambiar código</button>}
                <button className="btn btn-sm" onClick={async () => {
                  try { await api(`/api/admin/books/${book.id}/codes/${c.id}`, "PATCH", { revoked: !c.revoked }); toast("ok", c.revoked ? "Código restaurado" : "Código revocado"); reload(); }
                  catch (e) { toast("error", errText(e)); }
                }}>{c.revoked ? "Restaurar" : "Revocar"}</button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!changing} title="Cambiar código" confirmLabel="Usar este código" busy={busy} confirmDisabled={!newCode.trim()}
        onConfirm={() => doChange(false)} onCancel={() => { setChanging(null); setChangeError(""); }}
      >
        <p>El código de <strong className="text-fg">{changing?.label}</strong> dejará de funcionar de inmediato, también para quien ya esté leyendo. La etiqueta y la caducidad se mantienen.</p>
        <div>
          <label htmlFor="new-code" className="label text-fg">Nuevo código</label>
          <input id="new-code" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} className="field font-mono uppercase tracking-wider" placeholder="AMINA2026" spellCheck={false} autoComplete="off" />
        </div>
        {changeError && <p role="alert" className="err">{changeError}</p>}
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => doChange(true)}>Generar uno aleatorio</button>
      </ConfirmDialog>
    </div>
  );
}
