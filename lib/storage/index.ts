import "server-only";
import { isMock } from "../config";
import { assertSafeConfig } from "../safety";
import * as mock from "./mock";
import * as r2 from "./r2";

export interface Storage {
  /** Short-lived URL the admin's browser PUTs a WebP to (or another type: the text chunks are JSON). */
  presignPut(key: string, contentType?: string): Promise<string>;
  /** URL valid for `ttl` seconds (default 60) that returns the object. */
  presignGet(key: string, ttl?: number): Promise<string>;
  list(prefix: string): Promise<string[]>;
  /** Deletes every object under the prefix, in batches. Returns the count. */
  deletePrefix(prefix: string): Promise<number>;
  /** Size in bytes of every object under the prefix, by key. */
  listSizes(prefix: string): Promise<Record<string, number>>;
  /** Size in bytes of one object, or null when it does not exist. */
  head(key: string): Promise<number | null>;
  deleteKey(key: string): Promise<void>;
  /** The object as text (small JSON objects only), or null when it does not exist. */
  readText(key: string): Promise<string | null>;
  /** Like presignGet, but the browser saves it as an attachment called `filename`. */
  presignDownload(key: string, filename: string, ttl?: number): Promise<string>;
  /** S3 multipart upload (the original PDF): the server creates and completes it, the browser PUTs parts. */
  createMultipart(key: string): Promise<string>;
  presignPart(key: string, uploadId: string, part: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<{ part: number; size: number; etag: string }[]>;
  completeMultipart(key: string, uploadId: string, parts: { part: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}
export const storage = (): Storage => {
  assertSafeConfig();
  return isMock() ? mock : r2;
};

export { GET_TTL_S, MAX_ORIGINAL_BYTES, MAX_PARTS, OBJECT_RE, ORIGINAL_RE, PART_SIZE, TEXT_RE, originalKey, textKey, textPrefix } from "./constants";
