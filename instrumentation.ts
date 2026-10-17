// Runs once when the server starts. Refuses to boot on an unsafe production configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { enforceSafeConfig } = await import("./lib/safety");
  enforceSafeConfig();
}
