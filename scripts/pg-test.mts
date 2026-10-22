/**
 * `npm run test:pg [-- --e2e] [-- <vitest args>]`: starts a real PostgreSQL 17 server (the binaries ship with the `embedded-postgres`
 * dev dependency, no Docker or install needed), points the unit and API tests at it with TEST_DATABASE_URL, and stops it.
 * Everything else uses the embedded PGlite database; this is what proves the migrations and queries on real Postgres, the
 * engine production (Neon) runs. Port 5433 and a temporary data folder, so it cannot touch another database.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.PG_TEST_PORT ?? 5433);
const dir = await mkdtemp(path.join(os.tmpdir(), "nori-pg-"));
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "nori-test", port: PORT, persistent: false, onLog: () => {}, onError: () => {} });

let code = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("nori_test");
  const url = `postgres://postgres:nori-test@localhost:${PORT}/nori_test`;
  console.log(`PostgreSQL ready on port ${PORT}; running the tests against it...\n`);
  const raw = process.argv.slice(2);
  // `--e2e` runs the browser journey (apps and API on this database) instead of the unit tests.
  const e2e = raw[0] === "--e2e";
  const args = e2e ? ["--config", "vitest.e2e.config.ts", ...raw.slice(1)] : raw;
  code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...args], {
      stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url },
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error("Could not run against PostgreSQL:", (e as Error).message);
} finally {
  await pg.stop().catch(() => {});
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
