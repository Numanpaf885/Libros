// Book-mode geometry. A "unit" is what one turn moves over: a single page (phones, portrait) or a
// spread (wide landscape). Units are 0-based. Spread 0 is the cover alone on the right; spread k >= 1 is [2k, 2k+1].
export const unitOf = (page: number, wide: boolean) => (wide ? Math.floor(page / 2) : page - 1);
export const unitCount = (pageCount: number, wide: boolean) => (wide ? Math.floor(pageCount / 2) + 1 : pageCount);
/** The page the reader is "on" when a unit is shown (the left page of a spread, except the cover). */
export const pageOfUnit = (unit: number, wide: boolean) => (wide ? (unit === 0 ? 1 : unit * 2) : unit + 1);
/** [left, right] page numbers of a unit; null where there is none. A single page sits in `right`. */
export function pagesOfUnit(unit: number, wide: boolean, pageCount: number): [number | null, number | null] {
  if (!wide) return [null, unit >= 0 && unit < pageCount ? unit + 1 : null];
  const l = unit === 0 ? null : unit * 2;
  const r = unit === 0 ? 1 : unit * 2 + 1;
  return [l !== null && l <= pageCount ? l : null, r <= pageCount ? r : null];
}
export const realPages = (unit: number, wide: boolean, pageCount: number) =>
  pagesOfUnit(unit, wide, pageCount).filter((n): n is number => n !== null);
/** Units to keep fetched and decoded around `unit`: the current one, the next 2 and the previous 1 (in fetch order). */
export const windowUnits = (unit: number, total: number) =>
  [unit, unit + 1, unit + 2, unit - 1].filter((u) => u >= 0 && u < total);
