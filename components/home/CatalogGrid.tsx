"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import Cover from "./Cover";
import type { CatalogBook } from "./types";

type Sort = "recent" | "title";

export default function CatalogGrid({ books }: { books: CatalogBook[] }) {
  const [sort, setSort] = useState<Sort>("recent");
  const list = useMemo(() => {
    const l = [...books];
    if (sort === "title") l.sort((a, b) => a.title.localeCompare(b.title, "es"));
    else l.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return l;
  }, [books, sort]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-3xl">
          Todos los libros <span className="ml-1 font-sans text-lg font-normal text-muted tnum">({books.length})</span>
        </h2>
        <div>
          <label htmlFor="orden" className="mr-2 text-sm text-muted">Ordenar por</label>
          <select id="orden" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field w-auto! py-1.5">
            <option value="recent">Más recientes</option>
            <option value="title">Título A–Z</option>
          </select>
        </div>
      </div>
      {books.length < 3 && (
        <p className="-mt-4 mb-8 max-w-prose text-[15px] text-muted">
          {books.length === 1 ? "De momento hay un libro publicado. Los próximos aparecerán aquí en cuanto estén listos." : "Los próximos libros aparecerán aquí en cuanto estén listos."}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
        {list.map((b, i) => (
          <li key={b.slug} className="rise min-w-0" style={{ ["--i" as string]: i }}>
            <Link href={`/b/${b.slug}`} className="group press block rounded-card">
              <Cover slug={b.slug} title={b.title} transition className="transition-colors duration-150 group-hover:border-line-strong" />
              <h3 className="mt-3 text-lg leading-snug underline-offset-4 [overflow-wrap:anywhere] group-hover:underline">{b.title}</h3>
              {b.author && <p className="mt-0.5 text-sm text-muted">{b.author}</p>}
              <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm text-muted">
                <span className="tnum">{b.pageCount} páginas</span>
                {b.unlocked ? (
                  <span className="inline-flex items-center gap-1 text-ok"><Icon name="unlock" size={15} />Desbloqueado</span>
                ) : (
                  <Icon name="lock" size={15} className="shrink-0" />
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
