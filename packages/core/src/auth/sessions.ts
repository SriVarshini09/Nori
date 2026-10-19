import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { sha256 } from "./password.js";

export const SESSION_COOKIE = "jg_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = typeof users.$inferSelect;
/** The user row without the password hash, safe to return from the API. */
export type PublicUser = Omit<SessionUser, "passwordHash">;
export const publicUser = (u: SessionUser): PublicUser => {
  const { passwordHash: _h, ...rest } = u;
  return rest;
};

/** Create a session and return the raw token (only its sha256 is stored). */
export async function createSession(db: Db, userId: string, userAgent?: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent: userAgent?.slice(0, 500) ?? null,
  });
  return token;
}

/** The user owning an unexpired session, or null. */
export async function getSessionUser(db: Db, token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return row?.user ?? null;
}

export async function revokeSession(db: Db, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Drop expired sessions (housekeeping). */
export async function pruneSessions(db: Db): Promise<number> {
  const rows = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning();
  return rows.length;
}
