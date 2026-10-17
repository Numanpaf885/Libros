import { NextResponse } from "next/server";
import { z } from "zod";
import { getBookById } from "@/lib/db/repo";
import { guardAdmin, jsonError, safe } from "@/lib/http";
import { storage } from "@/lib/storage";

// Admin-only thumbnail: redirects to a 60 s presigned URL.
export const GET = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardAdmin(req);
  if (denied) return denied;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return jsonError(400, "Solicitud no válida");
  const book = await getBookById(id.data);
  if (!book) return jsonError(404, "No encontrado");
  const url = await storage().presignGet(book.cover_path);
  return NextResponse.redirect(new URL(url, req.url), { status: 302, headers: { "Cache-Control": "no-store" } });
});
