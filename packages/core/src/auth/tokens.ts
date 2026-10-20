import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { authTokens, sessions, users } from "../db/schema.js";
import { hashPassword, sha256, verifyPassword } from "./password.js";

export type AuthTokenKind = "reset" | "verify";

/** How long a link works: a reset is short-lived, a verification link can wait a few days. */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenKind, number> = { reset: 60 * 60_000, verify: 3 * 24 * 60 * 60_000 };

/**
 * Issue a one-time token and return the raw value (put it in a link; only its sha256 is stored).
 * Issuing a new token of the same kind retires the user's older unused ones, so only the latest link works.
 */
export async function issueAuthToken(db: Db, userId: string, kind: AuthTokenKind): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.update(authTokens).set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS[kind]) });
  return token;
}

/** Spend a token: returns its user id once, null if it is unknown, expired, already used or of another kind. */
export async function consumeAuthToken(db: Db, token: string | null | undefined, kind: AuthTokenKind): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db.update(authTokens).set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  return row?.userId ?? null;
}

/** Mark the address verified. Returns false when the user no longer exists. */
export async function markEmailVerified(db: Db, userId: string): Promise<boolean> {
  const rows = await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId)).returning();
  return rows.length > 0;
}

/** Replace the password after a reset link. Every session of that user is revoked, so a stolen cookie dies with the old password. */
export async function resetPassword(db: Db, token: string, newPassword: string): Promise<{ userId: string } | null> {
  const userId = await consumeAuthToken(db, token, "reset");
  if (!userId) return null;
  const rows = await db.update(users).set({ passwordHash: await hashPassword(newPassword), emailVerifiedAt: new Date() })
    .where(eq(users.id, userId)).returning();
  if (rows.length === 0) return null;
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return { userId };
}

/**
 * Change the password for a signed-in user who knows the current one. Other sessions are revoked
 * (the one making the request, identified by its token hash, stays signed in).
 */
export async function changePassword(
  db: Db, userId: string, current: string, next: string, keepSessionTokenHash?: string,
): Promise<"ok" | "wrong_password" | "no_password"> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.passwordHash) return "no_password";
  if (!(await verifyPassword(current, user.passwordHash))) return "wrong_password";
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(keepSessionTokenHash
    ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepSessionTokenHash))
    : eq(sessions.userId, userId));
  return "ok";
}

/** Housekeeping: drop links that expired or were spent more than a week ago. Returns how many. */
export async function pruneAuthTokens(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const rows = await db.delete(authTokens).where(or(lt(authTokens.expiresAt, cutoff), lt(authTokens.usedAt, cutoff))).returning();
  return rows.length;
}
