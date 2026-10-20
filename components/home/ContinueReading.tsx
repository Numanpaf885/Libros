"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { labelOf, labelTotal, parseLabels } from "@/lib/page-labels";
import Cover from "./Cover";
import type { CatalogBook } from "./types";

/** "Página 45 de 352" in the book's printed numbers when it has them. */
const pageText = (b: CatalogBook, p: number) => {
  const r = parseLabels(b.pageLabels, b.pageCount);
  return r.length ? `Página ${labelOf(r, p) || p} de ${labelTotal(r, b.pageCount)}` : `Página ${p} de ${b.pageCount}`;
};

/** Saved pages live in this browser only (localStorage). */
function readSaved(books: CatalogBook[]): string {
  const out: Record<string, number> = {};
  for (const b of books) {
    try {
      const v = Number(localStorage.getItem(`br:last:${b.slug}`));
      if (v >= 1 && v <= b.pageCount) out[b.slug] = v;
    } catch { /* ignore */ }
  }
  return JSON.stringify(out);
}

/** `synced`: pages saved on the account (signed-in readers). They win over this browser's own copy. */
export default function ContinueReading({ books, synced }: { books: CatalogBook[]; synced?: Record<string, number> }) {
  // Server snapshot is empty, so nothing flashes before localStorage is read.
  const raw = useSyncExternalStore(
    (cb) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); },
    () => readSaved(books),
    () => "pending",
  );
  // Until the browser's saved pages are read, reserve exactly the space the cards will take, so the
  // catalogue below never jumps when this section fills in.
  if (raw === "pending") {
    return (
      <section aria-hidden="true" className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6">
        <div className="mb-6 h-9" />
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {books.slice(0, 3).map((b) => <li key={b.slug} className="card h-[110px]" />)}
        </ul>
      </section>
    );
  }
  const saved = { ...(JSON.parse(raw) as Record<string, number>), ...(synced ?? {}) };
  const items = books.filter((b) => saved[b.slug] > 0 && saved[b.slug] <= b.pageCount);
  if (!items.length) return null;

  return (
    <section aria-labelledby="continuar" className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6">
      <h2 id="continuar" className="mb-6 text-3xl">Continuar leyendo</h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((b) => {
          const p = saved[b.slug];
          return (
            <li key={b.slug} className="min-w-0">
              <Link href={`/b/${b.slug}#p=${p}`} className="card press flex min-w-0 items-center gap-4 p-3 transition-colors hover:border-line-strong">
                <Cover slug={b.slug} title={b.title} className="w-16 shrink-0" eager />
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-lg [overflow-wrap:anywhere]">{b.title}</h3>
                  <p className="tnum truncate text-sm text-muted">{pageText(b, p)}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-label={`Progreso en ${b.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((p / b.pageCount) * 100)}>
                    <div className="h-full bg-accent" style={{ width: `${(p / b.pageCount) * 100}%` }} />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
