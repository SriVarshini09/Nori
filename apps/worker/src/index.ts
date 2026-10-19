/**
 * Standalone background worker: the scheduler and channel listeners from runtime.ts in their own process.
 * Use this with a Postgres DATABASE_URL (or with the API stopped). With embedded PGlite, prefer `npm run demo`,
 * which runs the same runtime inside the API (EMBED_WORKER=1) so one process owns the database.
 */
import "./env.js";
import { getDb, warmLLM } from "@jobgraph/core";
import { startRuntime } from "./runtime.js";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const db = await getDb();
  await warmLLM();
  const rt = await startRuntime(db, { name: "worker" });
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    (rt.consoleMode ? console.error : console.log)(`[worker] ${signal}: shutting down`);
    rt.stop();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[worker] fatal:", errMsg(e));
  process.exit(1);
});
