import "server-only";
import { isMock } from "../config";
import { assertSafeConfig } from "../safety";
import * as mock from "./mock";
import * as r2 from "./r2";

export interface Storage {
  /** Short-lived URL the admin's browser PUTs a WebP to. */
  presignPut(key: string): Promise<string>;
  /** URL valid for `ttl` seconds (default 60) that returns the object. */
  presignGet(key: string, ttl?: number): Promise<string>;
  list(prefix: string): Promise<string[]>;
  /** Deletes every object under the prefix, in batches. Returns the count. */
  deletePrefix(prefix: string): Promise<number>;
}
export const storage = (): Storage => {
  assertSafeConfig();
  return isMock() ? mock : r2;
};

export { GET_TTL_S, OBJECT_RE } from "./constants";
