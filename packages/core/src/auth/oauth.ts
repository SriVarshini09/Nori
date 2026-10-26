import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { profiles, users } from "../db/schema.js";
const normalizeEmail = (e: string) => e.trim().toLowerCase();

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleUserInfo> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("Google token response missing access_token");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed: ${infoRes.status}`);
  const info = (await infoRes.json()) as GoogleUserInfo;
  if (!info.email) throw new Error("Google account did not provide an email address");
  return info;
}

/**
 * Find or create a user from a verified Google OAuth login. Links to an existing account with the same email,
 * marks emailVerifiedAt, and ensures a profile row exists.
 */
export async function upsertGoogleUser(
  db: Db,
  info: GoogleUserInfo,
): Promise<{ user: typeof users.$inferSelect; isNew: boolean }> {
  const email = normalizeEmail(info.email);
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        name: existing.name || info.name?.trim() || null,
      })
      .where(eq(users.id, existing.id))
      .returning();
    return { user: updated!, isNew: false };
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: info.name?.trim() || null,
      emailVerifiedAt: new Date(),
    })
    .returning();
  await db
    .insert(profiles)
    .values({
      userId: created!.id,
      fullName: info.name?.trim() || null,
      email,
    })
    .onConflictDoNothing();
  return { user: created!, isNew: true };
}
