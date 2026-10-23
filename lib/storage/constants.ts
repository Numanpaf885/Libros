import { chunkName } from "../text-layer";

export const GET_TTL_S = 60;
export const PUT_TTL_S = 15 * 60;

/** Server-issued, unguessable prefix. 128 bits of randomness. */
export const PREFIX_RE = /^books\/[a-f0-9]{32}$/;
export const OBJECT_RE = /^books\/[a-f0-9]{32}\/(cover|[1-9][0-9]{0,4})\.webp$/;

/** A replacement upload is a temporary "uploading" row whose slug points at the book being replaced. */
export const REPLACE_SLUG = "__replace__";

/** The optional original PDF of a book, next to its page images. Never served except through the download flow. */
export const ORIGINAL_RE = /^books\/[a-f0-9]{32}\/original\.pdf$/;
export const originalKey = (prefix: string) => `${prefix}/original.pdf`;
/** Multipart upload of the original: 16 MB parts (R2 needs >= 5 MiB for every part but the last). */
export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_PARTS = 10_000;
/** Largest original PDF accepted (bytes). */
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024 * 1024;

/** The selectable text of a book: JSON chunks of 20 pages next to the page images (see lib/text-layer.ts). */
export const TEXT_RE = /^books\/[a-f0-9]{32}\/text\/\d{4}-\d{4}\.json$/;
export const textPrefix = (prefix: string) => `${prefix}/text`;
export const textKey = (prefix: string, chunk: number) => `${textPrefix(prefix)}/${chunkName(chunk)}`;
