import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { consumeAuthToken, issueAuthToken } from "../auth/tokens.js";
import { createPasswordUser } from "../users.js";
import { getDb, migrate, openTestDb, poolOptions } from "./client.js";
import { MIGRATIONS } from "./migrations.js";

const REAL = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!REAL)("running on a real PostgreSQL server (npm run test:pg)", () => {
  it("is PostgreSQL 16 or newer, in its own schema", async () => {
    const db = await openTestDb();
    const v = (await db.execute(sql.raw("SELECT version() AS v, current_schema() AS s"))).rows[0] as { v: string; s: string };
    expect(v.v).toMatch(/^PostgreSQL 1[6-9]/);
    expect(v.s).toMatch(/^t_[0-9a-f]{12}$/);
  });
});

describe("migrations and constraints", () => {
  it("record every migration once, and running them again changes nothing", async () => {
    const db = await openTestDb();
    const count = async () => Number(((await db.execute(sql.raw("SELECT count(*) AS n FROM _migrations"))).rows[0] as { n: string | number }).n);
    expect(await count()).toBe(MIGRATIONS.length);
    await migrate(db);
    await migrate(db);
    expect(await count()).toBe(MIGRATIONS.length);
  });

  it("enforces one default resume per person in the database itself", async () => {
    const db = await openTestDb();
    const u = await createPasswordUser(db, { email: "once@example.com", password: "long-enough-1" });
    const insert = (name: string) => db.execute(sql.raw(
      `INSERT INTO resume_docs (user_id, name, content, is_default) VALUES ('${u!.id}', '${name}', '{}'::jsonb, true)`));
    await insert("first");
    await expect(insert("second")).rejects.toThrow();
  });
});

describe("races that only real, concurrent connections can show", () => {
  it("ten simultaneous sign-ups with one email create exactly one account", async () => {
    const db = await openTestDb();
    const results = await Promise.all(Array.from({ length: 10 }, () => createPasswordUser(db, { email: "race@example.com", password: "long-enough-1" })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const n = Number(((await db.execute(sql.raw("SELECT count(*) AS n FROM users WHERE email = 'race@example.com'"))).rows[0] as { n: string | number }).n);
    expect(n).toBe(1);
  });

  it("a single-use link works for exactly one of ten simultaneous requests", async () => {
    const db = await openTestDb();
    const u = (await createPasswordUser(db, { email: "link@example.com", password: "long-enough-1" }))!;
    const token = await issueAuthToken(db, u.id, "reset");
    const used = await Promise.all(Array.from({ length: 10 }, () => consumeAuthToken(db, token, "reset")));
    expect(used.filter((x) => x === u.id)).toHaveLength(1);
    expect(used.filter((x) => x === null)).toHaveLength(9);
  });
});

describe.skipIf(!REAL)("the production start-up path (DATABASE_URL)", () => {
  it("opens the pool, applies every migration to an empty database, and works", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    try {
      const db = await getDb();
      const ids = ((await db.execute(sql.raw("SELECT id FROM _migrations ORDER BY id"))).rows as { id: string }[]).map((r) => r.id);
      expect(ids).toEqual(MIGRATIONS.map((m) => m.id).sort());
      const u = await createPasswordUser(db, { email: "boot@example.com", password: "long-enough-1" });
      expect(u?.email).toBe("boot@example.com");
      await migrate(db); // a second start changes nothing
      expect(((await db.execute(sql.raw("SELECT count(*)::int AS n FROM _migrations"))).rows[0] as { n: number }).n).toBe(MIGRATIONS.length);
    } finally { delete process.env.DATABASE_URL; }
  });
});

describe("production pool settings", () => {
  it("fail fast when no connection is free, release idle ones, and let DB_POOL_MAX size the pool", () => {
    const o = poolOptions("postgres://u:p@h/db", {});
    expect(o).toMatchObject({ max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, keepAlive: true });
    expect(poolOptions("x", { DB_POOL_MAX: "25" }).max).toBe(25);
    for (const bad of ["0", "-3", "abc", ""]) expect(poolOptions("x", { DB_POOL_MAX: bad }).max).toBe(10);
  });
});
