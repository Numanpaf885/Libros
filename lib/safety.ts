// Production safety checks. Throws a clear Error if the configuration is unsafe.
const isProd = () => process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

export function assertSafeConfig(): void {
  const problems: string[] = [];
  if (process.env.DATA_BACKEND === "mock" && isProd()) {
    problems.push(
      "DATA_BACKEND=mock is not allowed in production (NODE_ENV=production or VERCEL=1). " +
        "Mock mode uses a seeded admin with a known password. Unset DATA_BACKEND and configure Google Sheets and R2.",
    );
  }
  if (isProd() && (process.env.SESSION_SECRET ?? "").length < 32) {
    problems.push("SESSION_SECRET must be set to a random string of at least 32 characters in production.");
  }
  if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join("\n - ")}`);
}

/** Startup guard: log a clear error and exit instead of serving with an unsafe config. */
export function enforceSafeConfig(): void {
  try {
    assertSafeConfig();
  } catch (e) {
    console.error(`\nFATAL: ${(e as Error).message}\nRefusing to start.\n`);
    process.exit(1);
  }
}
