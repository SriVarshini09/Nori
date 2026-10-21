import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { schema } from "./schema.js";
import { MIGRATIONS } from "./migrations.js";

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let dbPromise: Promise<Db> | null = null;

/**
 * Shared database handle. Postgres when DATABASE_URL is set, otherwise embedded
 * PGlite under ./data/pglite (in memory when PGLITE_DIR=":memory:").
 */
/**
 * Pool settings for a real Postgres. A request that cannot get a connection fails after 10 s instead of hanging forever;
 * idle connections are released after 30 s (and kept alive while in use). DB_POOL_MAX sets the size (default 10).
 */
export function poolOptions(connectionString: string, env: Record<string, string | undefined> = process.env) {
  const max = Number.parseInt(env.DB_POOL_MAX ?? "", 10);
  return {
    connectionString, max: Number.isInteger(max) && max > 0 ? max : 10,
    idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, keepAlive: true,
  };
}

export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open(): Promise<Db> {
  let db: Db;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool(poolOptions(process.env.DATABASE_URL, process.env));
    // A serverless host (Neon) closes idle connections. Without a listener, node-postgres turns that into an uncaught error
    // and the process dies; with one, the pool just opens a fresh connection next time.
    pool.on("error", (err) => console.warn(`[db] idle connection dropped: ${err.message}`));
    db = drizzlePg(pool, { schema });
  } else {
    const dir = process.env.PGLITE_DIR ?? path.resolve("data/pglite");
    // PGlite's own mkdir is not recursive: a fresh checkout has no ./data yet and would crash on first start.
    if (dir !== ":memory:") mkdirSync(dir, { recursive: true });
    const client = dir === ":memory:" ? new PGlite() : new PGlite(dir);
    db = drizzlePglite(client, { schema });
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db) {
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`));
  const applied = await db.execute(sql.raw(`SELECT id FROM _migrations`));
  const done = new Set((applied.rows as { id: string }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.execute(sql.raw(stmt));
    }
    await db.execute(sql.raw(`INSERT INTO _migrations (id) VALUES ('${m.id}') ON CONFLICT DO NOTHING`));
  }
}

/**
 * A fresh database, not shared with getDb(). For tests. In memory (PGlite) by default; with TEST_DATABASE_URL set it is
 * a new schema on that real PostgreSQL server, so the same tests prove the migrations and queries on the real thing
 * (see scripts/pg-test.mts). Each call gets its own schema, so tests stay isolated.
 */
export async function openTestDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const name = `t_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${name}`);
    await admin.end();
    const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 3000, options: `-c search_path=${name}` });
    const real = drizzlePg(pool, { schema });
    await migrate(real);
    return real;
  }
  const db = drizzlePglite(new PGlite(), { schema });
  await migrate(db);
  return db;
}
