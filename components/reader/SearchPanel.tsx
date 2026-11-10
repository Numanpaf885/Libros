"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { errText } from "@/lib/client/api";
import { searchBook, showMarks } from "@/lib/client/search";
import type { SearchResult } from "@/lib/text-search";

/** The search's state, kept by the reader so it survives closing the panel (or the phone sheet). */
export function useBookSearch(slug: string) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(-1);
  const [doneQ, setDoneQ] = useState(""); // the query the results are for
  const ctl = useRef<AbortController | null>(null);
  const done = useRef("");

  const run = useCallback((query: string) => {
    ctl.current?.abort();
    const t = query.trim();
    if (t.length < 2) { done.current = ""; setDoneQ(""); setRes(null); setErr(""); setBusy(false); setActive(-1); showMarks(null); return; }
    if (t === done.current) return;
    const c = new AbortController();
    ctl.current = c;
    setBusy(true); setErr("");
    searchBook(slug, t, c.signal).then((r) => {
      if (c.signal.aborted) return;
      done.current = t;
      setDoneQ(t); setRes(r); setActive(-1); showMarks(r);
    }, (e) => {
      if (c.signal.aborted) return;
      setErr(errText(e)); setRes(null); showMarks(null);
    }).finally(() => { if (!c.signal.aborted) setBusy(false); });
  }, [slug]);
  // searches as you type, a moment after the last key
  useEffect(() => {
    const t = setTimeout(() => run(q), 350);
    return () => clearTimeout(t);
  }, [q, run]);
  useEffect(() => () => { ctl.current?.abort(); showMarks(null); }, []);
  const clear = () => { setQ(""); run(""); };
  return { q, setQ, res, doneQ, busy, err, active, setActive, run, clear };
}
export type BookSearch = ReturnType<typeof useBookSearch>;

interface Props {
  s: BookSearch;
  onJump: (page: number) => void;
  /** printed number of a file page (default: the file page itself) */
  nameOf?: (n: number) => string;
  autoFocus?: boolean;
}

/** "Buscar en el libro": the field, the result count, previous / next and the pages with matches. */
export default function SearchPanel({ s, onJump, nameOf = String, autoFocus = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  const pages = s.res?.pages ?? [];
  const pick = (i: number) => { if (!pages.length) return; const k = (i + pages.length) % pages.length; s.setActive(k); onJump(pages[k].page); };
  const n = s.res?.total ?? 0;
  const status = s.q.trim().length === 0 ? "" : s.q.trim().length < 2 ? "Escribe al menos 2 letras."
    : s.busy ? "Buscando…" : s.err ? s.err : !s.res ? ""
    : n === 0 ? `No hay resultados para «${s.q.trim()}».`
    : `${n.toLocaleString("es-ES")} ${n === 1 ? "resultado" : "resultados"} en ${pages.length}${s.res.truncated ? "+" : ""} ${pages.length === 1 ? "página" : "páginas"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="search-panel">
      <form role="search" className="space-y-2 border-b border-line p-3" onSubmit={(e) => { e.preventDefault(); if (s.res && s.q.trim() === s.doneQ) pick(s.active + 1); else s.run(s.q); }}>
        <div className="flex items-center gap-2">
          <label htmlFor="buscar-libro" className="sr-only">Buscar en el libro</label>
          <input
            id="buscar-libro" ref={input} type="search" value={s.q} maxLength={100} autoComplete="off" enterKeyHint="search" placeholder="Buscar en el libro"
            className="field min-h-11 min-w-0 flex-1" onChange={(e) => s.setQ(e.target.value)} data-testid="search-input"
            onKeyDown={(e) => { if (e.key === "Escape" && s.q) { e.stopPropagation(); s.clear(); } }}
          />
          <button type="button" className="btn btn-icon min-h-11! min-w-11!" disabled={pages.length < 2} onClick={() => pick(s.active - 1)} aria-label="Resultado anterior" title="Resultado anterior"><Icon name="back" size={18} /></button>
          <button type="button" className="btn btn-icon min-h-11! min-w-11!" disabled={!pages.length} onClick={() => pick(s.active + 1)} aria-label="Resultado siguiente" title="Resultado siguiente (Intro)" data-testid="search-next"><Icon name="next" size={18} /></button>
        </div>
        <p className={`text-sm ${s.err ? "text-danger" : "text-muted"} ${status ? "" : "sr-only"}`} role="status" aria-live="polite" data-testid="search-status">{status}</p>
      </form>
      {pages.length > 0 && (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-auto" data-testid="search-results">
          {pages.map((p, i) => (
            <li key={p.page}>
              <button
                type="button" onClick={() => pick(i)} aria-current={i === s.active ? "true" : undefined} data-page={p.page}
                className={`press block w-full px-3 py-2.5 text-left hover:bg-fg/5 ${i === s.active ? "bg-fg/5" : ""}`}
              >
                <span className="tnum flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">Pág. {nameOf(p.page)}</span>
                  <span className="text-muted">{p.count === 1 ? "1 coincidencia" : `${p.count} coincidencias`}</span>
                </span>
                {p.snippet && (
                  <span className="mt-0.5 block text-[15px] leading-snug" data-testid="search-snippet">
                    {p.snippet.text.slice(0, p.snippet.start)}<mark className="search-hit">{p.snippet.text.slice(p.snippet.start, p.snippet.end)}</mark>{p.snippet.text.slice(p.snippet.end)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
