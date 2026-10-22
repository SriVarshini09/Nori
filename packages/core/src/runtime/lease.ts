import { randomUUID } from "node:crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { runtimeLeases, runtimeState } from "../db/schema.js";

/** This process, for lease ownership. */
export const PROCESS_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Take or renew the lease `name` for `ttlMs`. True when this owner holds it afterwards: it was free, had expired, or
 * was already ours. One atomic statement, so two processes never both win.
 */
export async function acquireLease(db: Db, name: string, ttlMs: number, owner = PROCESS_ID): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await db.insert(runtimeLeases).values({ name, owner, expiresAt })
    .onConflictDoUpdate({
      target: runtimeLeases.name,
      set: { owner, expiresAt },
      setWhere: or(eq(runtimeLeases.owner, owner), lt(runtimeLeases.expiresAt, sql`now()`)),
    }).returning();
  return rows.length > 0 && rows[0].owner === owner;
}

/** Give the lease up (on shutdown) so another process can take over at once instead of waiting for it to expire. */
export async function releaseLease(db: Db, name: string, owner = PROCESS_ID): Promise<void> {
  await db.delete(runtimeLeases).where(and(eq(runtimeLeases.name, name), eq(runtimeLeases.owner, owner)));
}

/**
 * Run `fn` only while holding `name`, renewing the lease every third of `ttlMs` so a long run is never taken over.
 * Returns false (and does not run) when another process holds it. The lease is kept afterwards: this process keeps
 * the job until it stops or misses a renewal.
 */
export async function withLease(db: Db, name: string, ttlMs: number, fn: () => Promise<void>, owner = PROCESS_ID): Promise<boolean> {
  if (!(await acquireLease(db, name, ttlMs, owner))) return false;
  const renew = setInterval(() => { void acquireLease(db, name, ttlMs, owner).catch(() => {}); }, Math.max(1000, Math.floor(ttlMs / 3)));
  try { await fn(); } finally { clearInterval(renew); }
  return true;
}

export async function getState<T>(db: Db, key: string): Promise<T | undefined> {
  const [row] = await db.select().from(runtimeState).where(eq(runtimeState.key, key)).limit(1);
  return row?.value as T | undefined;
}

export async function setState(db: Db, key: string, value: unknown): Promise<void> {
  await db.insert(runtimeState).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: runtimeState.key, set: { value, updatedAt: new Date() } });
}
