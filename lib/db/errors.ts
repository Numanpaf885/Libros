import "server-only";

/** Why the spreadsheet could not be used: too slow, over its quota, or another failure (network, 5xx). */
export type SheetsProblem = "timeout" | "quota" | "error";

/**
 * Google Sheets did not answer in time, or kept refusing (quota). Pages show a Spanish error with "Reintentar"
 * (or the last data they had); API routes answer 503. Never shown to users as is.
 */
export class SheetsUnavailableError extends Error {
  constructor(readonly problem: SheetsProblem, readonly retryAfterMs = 15_000, options?: { cause?: unknown }) {
    super(`Google Sheets unavailable (${problem})`, options);
    this.name = "SheetsUnavailableError";
  }
}

/** The sheet has no tab with this name (or it has no header row): the feature that needs it stays hidden. */
export class MissingTabError extends Error {
  constructor(readonly tab: string) {
    super(`The \`${tab}\` tab is missing: /admin → Mantenimiento → «Actualizar base de datos»`);
    this.name = "MissingTabError";
  }
}

/** R2 (or the mock storage) did not answer in time. */
export class StorageUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Storage unavailable", options);
    this.name = "StorageUnavailableError";
  }
}

/** Errors that mean "an outside service is down for a moment", for which a 503 + "Reintentar" is the right answer. */
export const isUnavailable = (e: unknown): boolean =>
  e instanceof SheetsUnavailableError || e instanceof StorageUnavailableError ||
  // by name too: a module bundled twice (server layers in dev) has its own copy of the class
  ["SheetsUnavailableError", "StorageUnavailableError"].includes((e as Error)?.name);
