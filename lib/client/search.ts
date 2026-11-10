"use client";
// Reader: searching the book (the server route answers with pages, boxes and snippets) and the highlights over the pages,
// kept here so every page on screen (PDF mode or Book mode) can draw its own.
import { useSyncExternalStore } from "react";
import type { Box, SearchResult } from "@/lib/text-search";
import { ApiError, request } from "./api";

let marks: ReadonlyMap<number, readonly Box[]> = new Map();
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

/** Shows the matches of a search over the pages (null clears them). */
export function showMarks(result: SearchResult | null) {
  marks = new Map((result?.pages ?? []).map((p) => [p.page, p.boxes]));
  for (const fn of subs) fn();
}
const NONE: readonly Box[] = [];
/** The highlighted boxes of page n (fractions of the page). */
export function useMarks(n: number): readonly Box[] {
  return useSyncExternalStore(subscribe, () => marks.get(n) ?? NONE, () => NONE);
}

/** Runs a search. Rejects with an ApiError carrying the server's Spanish message (too short, too many, no text...). */
export async function searchBook(slug: string, q: string, signal?: AbortSignal): Promise<SearchResult> {
  const res = await request(`/api/books/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}`, { cache: "no-store", signal }, 20_000);
  const body = (await res.json().catch(() => null)) as (SearchResult & { error?: string }) | null;
  if (res.status === 401) throw new ApiError("Tu acceso a este libro ha terminado.");
  if (!res.ok || !body) throw new ApiError(res.status < 500 && body?.error ? body.error : "No se ha podido buscar. Inténtalo de nuevo.");
  return body;
}
