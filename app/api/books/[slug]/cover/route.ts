import { NextResponse } from "next/server";
import { getBookBySlug } from "@/lib/db/repo";
import { jsonError, safe } from "@/lib/http";
import { storage } from "@/lib/storage";

// Public on purpose: the catalogue shows covers without a code. Only PUBLISHED books, only the
// cover, and only via a presigned URL that lives 60 s. Pages still need a valid code.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const book = await getBookBySlug((await params).slug);
  if (!book || book.status !== "published") return jsonError(404, "No encontrado");
  const url = await storage().presignGet(book.cover_path);
  return NextResponse.redirect(new URL(url, req.url), { status: 302, headers: { "Cache-Control": "private, max-age=30" } });
});
