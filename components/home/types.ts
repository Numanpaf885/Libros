/** What the public pages may know about a published book. Never keys, prefixes or hashes. */
export interface CatalogBook {
  slug: string;
  title: string;
  author: string;
  category: string;
  year: string;
  description: string;
  pageCount: number;
  updatedAt: string;
  unlocked: boolean;
}
export const meta = (b: { category: string; year: string }) => [b.category, b.year].filter(Boolean).join(" · ");
