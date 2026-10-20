"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Cover from "@/components/home/Cover";
import { meta as metaLine } from "@/components/home/types";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import Icon from "@/components/ui/Icon";
import Sheet, { usePhone } from "@/components/ui/Sheet";
import Viewer from "@/components/reader/Viewer";
import { useMe } from "@/lib/client/me";

export interface BookInfo { slug: string; title: string; author: string; category: string; year: string; description: string; pageCount: number }
interface Meta { title: string; page_count: number; signed_in?: boolean; progress?: number | null; can_download?: boolean }
type Outcome = { ok: true; progress: number; canDownload: boolean } | { error: string };

async function fetchMeta(slug: string): Promise<Meta | null> {
  const res = await fetch(`/api/books/${encodeURIComponent(slug)}/meta`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as Meta) : null;
}
async function tryUnlock(slug: string, code: string): Promise<Outcome> {
  const res = await fetch(`/api/books/${encodeURIComponent(slug)}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    return { error: msg ?? "No se pudo comprobar el código. Inténtalo de nuevo." };
  }
  const m = await fetchMeta(slug);
  return m ? { ok: true, progress: m.progress ?? 0, canDownload: !!m.can_download } : { error: "No se pudo abrir el libro. Inténtalo de nuevo." };
}
/** The page saved on this device, unless the account has a later one from another device (`remote`). */
const savedPage = (slug: string, count: number, remote = 0) => {
  if (remote > 1 && remote <= count) return remote;
  try { const v = Number(localStorage.getItem(`br:last:${slug}`)); return v > 1 && v <= count ? v : 0; } catch { return 0; }
};
/** #p=N opens on that page; #leer just opens the reader. */
function readHash(): { page: number | null; open: boolean } {
  const h = window.location.hash;
  const m = /^#p=(\d+)$/.exec(h);
  return { page: m ? Number(m[1]) : null, open: !!m || h === "#leer" };
}

export default function BookClient({ book, contact, siteName }: { book: BookInfo; contact: string; siteName: string }) {
  const { slug } = book;
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [reading, setReading] = useState<null | { start: number; offer: number }>(null);
  const [saved, setSaved] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [canDownload, setCanDownload] = useState(false); // signed in, with the download permission, and this book is theirs
  const phone = usePhone(); // phones: the code is entered in a bottom sheet
  const me = useMe();

  const remote = useRef(0); // page saved on the account (signed-in readers), read with the meta request
  const open = useCallback((start: number | null) => {
    const sp = savedPage(slug, book.pageCount, remote.current);
    setReading(start ? { start, offer: 0 } : { start: 1, offer: sp });
  }, [slug, book.pageCount]);

  // The initial check must be safe to run twice (React StrictMode re-runs effects in dev): the
  // job is started once and kept in a ref, so a second run reuses it instead of finding the
  // ?code= already stripped from the URL and discarding the first run's result.
  const initial = useRef<Promise<{ unlocked: boolean; error?: string; hash: { page: number | null; open: boolean }; viaLink: boolean; progress: number; canDownload: boolean }> | null>(null);
  useEffect(() => {
    if (!initial.current) {
      const url = new URL(window.location.href);
      const hash = readHash();
      const c = url.searchParams.get("code");
      if (c) {
        // Strip the secret from the address bar / history before anything else happens (keep #p=N).
        url.searchParams.delete("code");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
        initial.current = tryUnlock(slug, c).then((o) => ({ unlocked: "ok" in o, error: "error" in o ? o.error : undefined, hash, viaLink: true, progress: "ok" in o ? o.progress : 0, canDownload: "ok" in o && o.canDownload }));
      } else {
        initial.current = fetchMeta(slug).then((m) => ({ unlocked: !!m, hash, viaLink: false, progress: m?.progress ?? 0, canDownload: !!m?.can_download }));
      }
    }
    let dead = false;
    initial.current.then((r) => {
      if (dead) return;
      remote.current = r.progress;
      setCanDownload(r.canDownload);
      setUnlocked(r.unlocked);
      setSaved(savedPage(slug, book.pageCount, r.progress));
      if (r.error) setError(r.error);
      setChecking(false);
      // A ?code= link and a #p= / #leer link go straight into the book.
      if (r.unlocked && (r.viaLink || r.hash.open)) open(r.hash.page);
    }).catch(() => { if (!dead) { setError("Algo ha salido mal. Inténtalo de nuevo."); setChecking(false); } });
    return () => { dead = true; };
  }, [slug, book.pageCount, open]);

  const close = useCallback(() => {
    setReading(null);
    remote.current = 0; // this device's copy is now the latest
    setSaved(savedPage(slug, book.pageCount));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [slug, book.pageCount]);
  const expired = useCallback(() => { setReading(null); setUnlocked(false); setError("Tu acceso ha terminado. Introduce un código válido."); }, []);

  if (reading && unlocked) {
    return <Viewer slug={slug} title={book.title} pageCount={book.pageCount} initialPage={reading.start} offer={reading.offer} canDownload={canDownload} onClose={close} onExpired={expired} />;
  }

  const codeForm = (
    <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true); setError("");
                    const h = readHash();
                    tryUnlock(slug, code).then((o) => {
                      if ("ok" in o) { remote.current = o.progress; setCanDownload(o.canDownload); setSheet(false); setUnlocked(true); setSaved(savedPage(slug, book.pageCount, o.progress)); open(h.page); }
                      else setError(o.error);
                      setBusy(false);
                    }).catch(() => { setError("Algo ha salido mal. Inténtalo de nuevo."); setBusy(false); });
                  }}
                  className={phone ? "space-y-4" : "panel max-w-md space-y-4 p-5"}
                  noValidate
                >
                  <div>
                    <h2 className="text-xl">Introduce tu código</h2>
                    <p className="hint mt-1">Escríbelo una vez y podrás leer el libro completo.</p>
                  </div>
                  <div>
                    <label htmlFor="code" className="label">Código de acceso</label>
                    <input
                      id="code" name="code" required maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                      value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                      aria-invalid={!!error} aria-describedby={error ? "code-error" : undefined}
                      className="field font-mono text-lg uppercase tracking-[0.2em]"
                    />
                    {error && <p id="code-error" role="alert" className="err mt-2">{error}</p>}
                  </div>
                  <button aria-busy={busy} disabled={busy || !code.trim()} className="btn btn-primary min-h-11 w-full">Abrir libro</button>
                  <p className="hint">{contact}</p>
                  {me.status === "ready" && !me.user && <p className="hint">¿Tienes cuenta? <Link href={`/entrar?next=/b/${slug}`} className="underline underline-offset-4">Entra</Link> y tus libros se abrirán sin código.</p>}
                </form>
  );

  return (
    <>
      <SiteHeader siteName={siteName} />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6 md:py-12">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-fg"><Icon name="back" size={16} />Catálogo</Link>
        <div className="mt-6 grid items-start gap-8 md:grid-cols-[minmax(0,300px)_1fr] md:gap-16">
          <Cover slug={slug} title={book.title} className="mx-auto w-full max-w-[260px] md:sticky md:top-24 md:max-w-none" eager transition />
          <div className="max-w-2xl">
            {metaLine(book) && <p className="text-[15px] text-muted">{metaLine(book)}</p>}
            <h1 className="mt-1 text-4xl md:text-5xl">{book.title}</h1>
            {book.author && <p className="mt-2 text-lg text-muted">de {book.author}</p>}
            <p className="tnum mt-3 text-sm text-muted">{book.pageCount} páginas</p>
            {book.description && <p className="mt-6 max-w-prose whitespace-pre-line text-base leading-7">{book.description}</p>}

            <div className="mt-8">
              {checking ? (
                <div className="skeleton h-40 max-w-md rounded-card" aria-label="Cargando" />
              ) : unlocked ? (
                <div className="flex flex-wrap items-center gap-3">
                  {saved > 0 ? (
                    <>
                      <button className="btn btn-primary min-h-11 px-6" onClick={() => open(saved)}>Continuar en la página {saved}</button>
                      <button className="btn min-h-11 px-6" onClick={() => open(1)}>Empezar desde el principio</button>
                    </>
                  ) : (
                    <button className="btn btn-primary min-h-11 px-8" onClick={() => open(1)}>Leer<Icon name="arrow" size={18} className="nudge" /></button>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-sm text-ok"><Icon name="unlock" size={16} />Desbloqueado</span>
                </div>
              ) : (
                <>
                  {phone ? (
                    <div className="max-w-md space-y-3">
                      <button type="button" className="btn btn-primary min-h-12 w-full" onClick={() => setSheet(true)}><Icon name="lock" size={18} />Introducir código</button>
                      <p className="hint">{contact}</p>
                      <Sheet open={sheet} onClose={() => setSheet(false)} label="Introduce tu código">
                        {codeForm}
                      </Sheet>
                    </div>
                  ) : (
                    codeForm
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
