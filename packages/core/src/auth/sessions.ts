import { randomBytes } from "node:crypto";
import { and, eq, gt, lt, ne } from "drizzle-orm";
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

export type SessionInfo = { id: string; userAgent: string | null; createdAt: Date; expiresAt: Date; current: boolean };

/** A user's live sessions, newest first. `currentToken` marks the one the request came from. */
export async function listSessions(db: Db, userId: string, currentToken?: string | null): Promise<SessionInfo[]> {
  const rows = await db.select().from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  const cur = currentToken ? sha256(currentToken) : null;
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({ id: r.id, userAgent: r.userAgent, createdAt: r.createdAt, expiresAt: r.expiresAt, current: r.tokenHash === cur }));
}

/** Revoke one of the user's own sessions by id. False when it is not theirs or is already gone. */
export async function revokeSessionById(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const rows = await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).returning();
  return rows.length > 0;
}

/** Sign out everywhere except the session making the request. Returns how many were revoked. */
export async function revokeOtherSessions(db: Db, userId: string, currentToken: string | null | undefined): Promise<number> {
  const cond = currentToken ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, sha256(currentToken))) : eq(sessions.userId, userId);
  return (await db.delete(sessions).where(cond).returning()).length;
}
