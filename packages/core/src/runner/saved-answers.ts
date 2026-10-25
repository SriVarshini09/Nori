import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { profiles, type Preferences } from "../db/schema.js";
import { getProfile } from "../users.js";

/**
 * Answers the person typed for questions Nori could not answer, kept so the same question on the next application is
 * filled in without asking again. Stored in the profile's preferences (server-owned, like the agent bookkeeping), keyed
 * by the question's normalised label.
 */
export const savedKey = (label: string): string => label.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Questions whose answer belongs to one posting or one moment, never carried to another employer. */
const JOB_SPECIFIC = /why (do|are|would|this|us|you|work)|cover letter|tell us (about|why)|describe|what (excites|interests|draws|attracts)|motivat|how did you hear|referr|verification|security code|password|captcha|sign.?in|account/i;
/** Question types that are not a stable personal answer. */
const NOT_REMEMBERED_TYPES = new Set(["file", "textarea", "captcha", "account", "blocked", "verification_code"]);
const MAX_VALUE = 200;
const MAX_SAVED = 200;

export function isRememberable(label: string, value: string, type?: string): boolean {
  const v = value.trim();
  if (!v || v.length > MAX_VALUE) return false;
  if (type && NOT_REMEMBERED_TYPES.has(type)) return false;
  return !JOB_SPECIFIC.test(label);
}

export type SavedAnswers = Record<string, { label: string; value: string }>;

export function savedAnswersOf(preferences: unknown): SavedAnswers {
  const s = (preferences as { savedAnswers?: SavedAnswers } | null | undefined)?.savedAnswers;
  return s && typeof s === "object" ? s : {};
}

/** label -> value for the answer generator. */
export function savedValues(preferences: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(savedAnswersOf(preferences)).map(([k, v]) => [k, v.value]));
}

/** Remember the answers worth keeping. `types` maps a label to its form field type when known. Returns how many were saved. */
export async function rememberAnswers(db: Db, userId: string, answers: Record<string, string>, types: Record<string, string> = {}): Promise<number> {
  const keep = Object.entries(answers).filter(([label, value]) => isRememberable(label, value, types[label]));
  if (!keep.length) return 0;
  const profile = await getProfile(db, userId);
  const saved = { ...savedAnswersOf(profile.preferences) };
  for (const [label, value] of keep) saved[savedKey(label)] = { label, value: value.trim() };
  // Newest last: when over the limit, drop the oldest entries.
  const entries = Object.entries(saved);
  const trimmed = Object.fromEntries(entries.length > MAX_SAVED ? entries.slice(entries.length - MAX_SAVED) : entries);
  await db.update(profiles).set({ preferences: { ...(profile.preferences as Preferences), savedAnswers: trimmed } as Preferences, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return keep.length;
}

/** Add or update a single remembered answer in the profile's preferences. */
export async function upsertSavedAnswer(db: Db, userId: string, label: string, value: string): Promise<SavedAnswers> {
  const cleanLabel = label.trim().slice(0, 200);
  const cleanValue = value.trim().slice(0, MAX_VALUE);
  if (!cleanLabel || !cleanValue) throw new Error("Both question label and answer value are required");
  const key = savedKey(cleanLabel);
  if (!key) throw new Error("Invalid question label");
  const profile = await getProfile(db, userId);
  const saved: SavedAnswers = { ...savedAnswersOf(profile.preferences), [key]: { label: cleanLabel, value: cleanValue } };
  const entries = Object.entries(saved);
  const trimmed = Object.fromEntries(entries.length > MAX_SAVED ? entries.slice(entries.length - MAX_SAVED) : entries);
  await db.update(profiles)
    .set({ preferences: { ...(profile.preferences as Preferences), savedAnswers: trimmed } as Preferences, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return trimmed;
}

/** Delete one remembered answer by its normalized key (or label). */
export async function deleteSavedAnswer(db: Db, userId: string, keyOrLabel: string): Promise<SavedAnswers> {
  const key = savedKey(keyOrLabel);
  const profile = await getProfile(db, userId);
  const saved: SavedAnswers = { ...savedAnswersOf(profile.preferences) };
  delete saved[key];
  delete saved[keyOrLabel];
  await db.update(profiles)
    .set({ preferences: { ...(profile.preferences as Preferences), savedAnswers: saved } as Preferences, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return saved;
}

/** Clear all remembered answers for a user. */
export async function clearSavedAnswers(db: Db, userId: string): Promise<SavedAnswers> {
  const profile = await getProfile(db, userId);
  await db.update(profiles)
    .set({ preferences: { ...(profile.preferences as Preferences), savedAnswers: {} } as Preferences, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return {};
}
