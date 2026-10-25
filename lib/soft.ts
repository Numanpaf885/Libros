import "server-only";
import { isUnavailable } from "./db/errors";

/**
 * The value, or `fallback` when Google Sheets or the storage could not answer in time: the page renders with what it
 * has (and says so) instead of failing. Real bugs still throw.
 */
export async function softly<T, F>(p: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await p;
  } catch (e) {
    if (isUnavailable(e)) return fallback;
    throw e;
  }
}
