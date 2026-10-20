"use client";
// Images instead of a PDF: choosing, ordering and turning photos into the same WebP pages a PDF upload produces.
import type { OpenPdf } from "./render-pdf";

export const MAX_IMAGES = 1000;
export const IMG_MAX_W = 1400;
const IMG_QUALITY = 0.8;
const HEIC_MSG = "Convierte las fotos HEIC a JPG antes de subirlas.";

export type Rotation = 0 | 90 | 180 | 270;
export interface ImageItem { id: string; file: File; rot: Rotation }
export interface ImagePlan { items: ImageItem[]; /** id of the image used as the cover (its thumbnail) */ coverId: string }

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
/** Natural order: p2 before p10. */
export const byName = (a: ImageItem, b: ImageItem) => collator.compare(a.file.name, b.file.name) || a.file.lastModified - b.file.lastModified;
export const byDate = (a: ImageItem, b: ImageItem) => a.file.lastModified - b.file.lastModified || collator.compare(a.file.name, b.file.name);

const ext = (n: string) => n.slice(n.lastIndexOf(".") + 1).toLowerCase();
const isHeic = (f: File) => /heic|heif/.test(f.type) || ["heic", "heif"].includes(ext(f.name));
const isSupported = (f: File) => ["image/jpeg", "image/png", "image/webp"].includes(f.type) || (!f.type && ["jpg", "jpeg", "png", "webp"].includes(ext(f.name)));
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

let seq = 0;
const newId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Splits a selection into usable images (natural order) and a message about what was left out. */
export function acceptFiles(files: File[], have: ImageItem[]): { items: ImageItem[]; message: string } {
  const seen = new Set(have.map((i) => `${i.file.name}|${i.file.size}|${i.file.lastModified}`));
  const items: ImageItem[] = [];
  let heic = 0, other = 0, dup = 0;
  for (const f of files) {
    if (isHeic(f)) { heic++; continue; }
    if (!isSupported(f)) { other++; continue; }
    const k = `${f.name}|${f.size}|${f.lastModified}`;
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    items.push({ id: newId(), file: f, rot: 0 });
  }
  items.sort(byName);
  const notes: string[] = [];
  if (heic) notes.push(HEIC_MSG);
  if (other) notes.push("Solo se admiten imágenes JPG, PNG y WebP.");
  if (dup) notes.push(dup === 1 ? "Una imagen ya estaba en la lista." : `${dup} imágenes ya estaban en la lista.`);
  const room = MAX_IMAGES - have.length;
  if (items.length > room) {
    notes.push(`Máximo ${MAX_IMAGES.toLocaleString("es-ES")} imágenes por libro.`);
    items.length = Math.max(0, room);
  }
  return { items, message: notes.join(" ") };
}

/** The order the upload is identified by: names, sizes and the final order (so the same files in the same order resume). */
export const imagesFingerprint = (items: ImageItem[]) => `img|${items.length}|${items.map((i) => `${i.file.name}:${i.file.size}`).join(",")}`;

/** Decodes with the camera's rotation (EXIF) already applied. */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`No se puede leer la imagen ${file.name}.`);
  }
}

/** Draws `bmp` rotated by `rot` clockwise, no wider than `maxW` (never enlarged), on white. */
function toCanvas(bmp: ImageBitmap, rot: Rotation, maxW: number): HTMLCanvasElement {
  const quarter = rot === 90 || rot === 270;
  const srcW = quarter ? bmp.height : bmp.width;
  const srcH = quarter ? bmp.width : bmp.height;
  const k = Math.min(1, maxW / srcW);
  const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  const dw = quarter ? h : w, dh = quarter ? w : h; // size of the image before rotation
  ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
  return c;
}

/** One image to a WebP blob (max `maxW` wide, quality 0.8), the same format PDF pages are stored in. */
export async function renderImage(item: ImageItem, maxW = IMG_MAX_W): Promise<Blob> {
  const bmp = await decode(item.file);
  try {
    const c = toCanvas(bmp, item.rot, maxW);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", IMG_QUALITY));
    c.width = c.height = 0;
    if (!blob || blob.type !== "image/webp") throw new Error("webp encoding unsupported");
    return blob;
  } finally {
    bmp.close();
  }
}

/** A small preview (object URL) of an image, rotation included. */
export async function makeThumb(item: ImageItem, w = 200): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(item.file, { imageOrientation: "from-image", resizeWidth: w * 2, resizeQuality: "medium" });
  } catch {
    bmp = await decode(item.file);
  }
  try {
    const c = toCanvas(bmp, item.rot, w);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.7));
    c.width = c.height = 0;
    if (!blob) throw new Error("thumb failed");
    return URL.createObjectURL(blob);
  } finally {
    bmp.close();
  }
}

/** The images as an upload source with the same shape as an opened PDF. */
export function openImages(plan: ImagePlan): OpenPdf & { renderCover(maxWidth: number): Promise<Blob> } {
  const { items } = plan;
  const cover = items.find((i) => i.id === plan.coverId) ?? items[0];
  return {
    pageCount: items.length,
    render: (n, maxWidth) => renderImage(items[n - 1], maxWidth),
    renderCover: (maxWidth) => renderImage(cover, maxWidth),
    destroy: async () => {},
  };
}
