export const GET_TTL_S = 60;
export const PUT_TTL_S = 15 * 60;

/** Server-issued, unguessable prefix. 128 bits of randomness. */
export const PREFIX_RE = /^books\/[a-f0-9]{32}$/;
export const OBJECT_RE = /^books\/[a-f0-9]{32}\/(cover|[1-9][0-9]{0,4})\.webp$/;

/** A replacement upload is a temporary "uploading" row whose slug points at the book being replaced. */
export const REPLACE_SLUG = "__replace__";
