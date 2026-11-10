"use client";
import { chapterIndexOf, chapterRanges, type Chapter } from "@/lib/chapters";

interface Props {
  chapters: Chapter[];
  pageCount: number;
  /** the page on screen: its chapter is marked */
  current: number;
  onJump: (page: number) => void;
  /** printed number of a file page (default: the file page itself) */
  nameOf?: (n: number) => string;
}

/** The book's chapters (a side panel on desktop, a bottom sheet on phones): the one being read is marked. */
export default function ChaptersList({ chapters, pageCount, current, onJump, nameOf = String }: Props) {
  const here = chapterIndexOf(chapters, current);
  return (
    <ol className="divide-y divide-line" data-testid="chapter-list">
      {chapterRanges(chapters, pageCount).map((r, i) => (
        <li key={r.from}>
          <button
            type="button" onClick={() => onJump(r.from)} aria-current={i === here ? "true" : undefined}
            className={`press flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-fg/5 ${i === here ? "bg-fg/5" : ""}`}
          >
            <span className={`tnum w-7 shrink-0 text-sm ${i === here ? "font-semibold text-accent" : "text-muted"}`}>{i + 1}</span>
            <span className={`min-w-0 flex-1 text-[15px] ${i === here ? "font-semibold" : "font-medium"}`}>{r.t}</span>
            <span className="tnum shrink-0 text-sm text-muted">Pág. {nameOf(r.from)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
