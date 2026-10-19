import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
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
export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open(): Promise<Db> {
  let db: Db;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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

/** A fresh in-memory database, not shared with getDb(). For tests. */
export async function openTestDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migrate(db);
  return db;
}
