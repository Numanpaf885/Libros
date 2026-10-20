// Which way a PDF download is built. Pure and shared by the server (validation) and the dialog (what it shows).
import type { DownloadMethod } from "./types";

export const MB = 1024 * 1024;
/** Largest original the browser may fetch whole to cut pages from it. */
export const MAX_CUT_BYTES = { Ordenador: 300 * MB, Móvil: 100 * MB } as const;
export type Device = keyof typeof MAX_CUT_BYTES;

export interface MethodInput {
  from: number;
  to: number;
  pageCount: number;
  /** bytes of the stored original PDF (0 = none) */
  originalSize: number;
  /** average size in bytes of one page image (0 = unknown) */
  avgPageBytes: number;
  device: Device;
}
export interface MethodChoice { method: DownloadMethod; estimate: number }

/** "original" = the whole original is sent; "recorte" = pages cut from it in the browser; "imagenes" = built from page images. */
export function chooseMethod(i: MethodInput): MethodChoice {
  const pages = Math.max(0, i.to - i.from + 1);
  const images = { method: "imagenes" as const, estimate: Math.round(pages * i.avgPageBytes) };
  if (i.originalSize <= 0) return images;
  if (i.from === 1 && i.to === i.pageCount) return { method: "original", estimate: i.originalSize };
  const smaller = i.avgPageBytes <= 0 || i.originalSize < images.estimate;
  if (smaller && i.originalSize <= MAX_CUT_BYTES[i.device]) return { method: "recorte", estimate: i.originalSize };
  return images;
}

/** Server check of the method a client asks for. */
export function methodAllowed(method: DownloadMethod, i: Pick<MethodInput, "from" | "to" | "pageCount" | "originalSize" | "device">): boolean {
  if (method === "imagenes") return true;
  if (i.originalSize <= 0) return false;
  if (method === "original") return i.from === 1 && i.to === i.pageCount;
  return i.originalSize <= MAX_CUT_BYTES[i.device];
}

export function formatBytes(n: number): string {
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} GB`;
  if (n >= 10 * MB) return `${Math.round(n / MB).toLocaleString("es-ES")} MB`;
  if (n >= MB) return `${(n / MB).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(n / 1024)).toLocaleString("es-ES")} KB`;
}

/** The same rule as the server's deviceOf(): phones and tablets are "Móvil". */
export const deviceOfUa = (ua: string): Device => (/Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "Móvil" : "Ordenador");
