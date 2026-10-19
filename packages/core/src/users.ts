import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { users, profiles, ONBOARDING_STEPS, type OnboardingState, type OnboardingStep } from "./db/schema.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./auth/password.js";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Dev fallback: returns (creating if needed) the user named by `email`
 * (default: DEFAULT_USER_EMAIL, else me@example.com).
 */
export async function ensureDefaultUser(db: Db, email: string = process.env.DEFAULT_USER_EMAIL ?? "me@example.com") {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return existing;
  const [u] = await db.insert(users).values({ email }).onConflictDoNothing().returning();
  const user = u ?? (await db.query.users.findFirst({ where: eq(users.email, email) }))!;
  await db.insert(profiles).values({ userId: user.id, email }).onConflictDoNothing();
  return user;
}

export async function getProfile(db: Db, userId: string) {
  let p = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!p) {
    [p] = await db.insert(profiles).values({ userId }).onConflictDoNothing().returning();
    p ??= (await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }))!;
  }
  return p;
}

/** Create a password user and their profile. Returns null when the email is taken. */
export async function createPasswordUser(db: Db, input: { email: string; password: string; name?: string | null }) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim() || null;
  const [u] = await db.insert(users).values({ email, name, passwordHash }).onConflictDoNothing().returning();
  if (u) {
    await db.insert(profiles).values({ userId: u.id, email, fullName: name }).onConflictDoNothing();
    return u;
  }
  // An account without a password was created by a dev fallback or an agent run, never by a person:
  // let the person claim it by signing up instead of refusing with "already exists".
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!existing || existing.passwordHash) return null;
  const [claimed] = await db.update(users).set({ passwordHash, name: name ?? existing.name }).where(eq(users.id, existing.id)).returning();
  await db.insert(profiles).values({ userId: claimed.id, email, fullName: name }).onConflictDoNothing();
  return claimed;
}

/** Email + password check with the same scrypt work whether or not the user exists. */
export async function authenticate(db: Db, email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  return ok && user?.passwordHash ? user : null;
}

/** The step after `step` in wizard order (done stays done). */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

/**
 * New onboarding state after submitting `submitted`: advances to the following step but never
 * moves backwards (editing an earlier step keeps progress). Sets completedAt on reaching done.
 */
export function advanceOnboarding(current: OnboardingState | null | undefined, submitted: OnboardingStep, now = new Date()): OnboardingState {
  const cur = current && ONBOARDING_STEPS.includes(current.step) ? current : { step: "resume" as const };
  const next = nextOnboardingStep(submitted);
  const step = ONBOARDING_STEPS.indexOf(next) > ONBOARDING_STEPS.indexOf(cur.step) ? next : cur.step;
  const completedAt = step === "done" ? cur.completedAt ?? now.toISOString() : cur.completedAt ?? null;
  return { step, completedAt };
}
