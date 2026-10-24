import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { llmUsage } from "../db/schema.js";
import { type LLMUsage, type Meter } from "./index.js";
import type { ModelSource } from "./credentials.js";

/**
 * Daily token accounting per user. Every model call made on a user's behalf is added to llm_usage for the UTC day,
 * whichever key served it. Only the shared key (HOSTED_LLM_*) is capped: a user with their own key pays their own bill.
 * When the cap is reached the call is refused with LLMCapExceededError, which withFallback turns into the heuristic
 * path, so nothing stops; the writing is just rule-based until midnight UTC.
 */

/** Tokens per user per UTC day on the shared key. HOSTED_LLM_DAILY_TOKEN_CAP; unset = 300000; 0 / off = no cap. */
export const DEFAULT_DAILY_TOKEN_CAP = 300_000;
export function dailyTokenCap(): number | null {
  const raw = process.env.HOSTED_LLM_DAILY_TOKEN_CAP?.trim();
  if (raw === undefined || raw === "") return DEFAULT_DAILY_TOKEN_CAP;
  if (/^(0|off|none|unlimited)$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_TOKEN_CAP;
}

export class LLMCapExceededError extends Error {
  constructor(public readonly used: number, public readonly cap: number) {
    super(`Daily model allowance used up: ${used.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} tokens today on the shared key. ` +
      "Nori uses its rule-based fallback until midnight UTC; add your own key in Settings for no limit.");
    this.name = "LLMCapExceededError";
  }
}

/** The UTC calendar day usage is counted in, as YYYY-MM-DD. */
export const utcDay = (d = new Date()): string => d.toISOString().slice(0, 10);
/** Start of the next UTC day. */
export function nextUtcMidnight(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

export type UsageToday = { promptTokens: number; completionTokens: number; totalTokens: number; calls: number };

/** Add one call's tokens to the user's row for today (insert or increment). */
export async function addUsage(db: Db, userId: string, u: Pick<LLMUsage, "promptTokens" | "completionTokens" | "calls">, day = utcDay()): Promise<void> {
  const prompt = Math.max(0, Math.round(u.promptTokens)), completion = Math.max(0, Math.round(u.completionTokens)), calls = Math.max(1, u.calls);
  await db.insert(llmUsage).values({ userId, day, promptTokens: prompt, completionTokens: completion, calls })
    .onConflictDoUpdate({
      target: [llmUsage.userId, llmUsage.day],
      set: {
        promptTokens: sql`${llmUsage.promptTokens} + ${prompt}`,
        completionTokens: sql`${llmUsage.completionTokens} + ${completion}`,
        calls: sql`${llmUsage.calls} + ${calls}`,
        updatedAt: new Date(),
      },
    });
}

/** What the user has spent today. */
export async function usageToday(db: Db, userId: string, day = utcDay()): Promise<UsageToday> {
  const [row] = await db.select().from(llmUsage).where(and(eq(llmUsage.userId, userId), eq(llmUsage.day, day))).limit(1);
  const promptTokens = row?.promptTokens ?? 0, completionTokens = row?.completionTokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, calls: row?.calls ?? 0 };
}

/** Usage as shown in Settings. `capTokens` is null when this user is not capped (own key, local model, or no cap set). */
export type UsageView = UsageToday & {
  /** Whether the shared key serves this user, so the cap applies. */
  shared: boolean;
  capTokens: number | null;
  remainingTokens: number | null;
  /** True when the shared key's allowance is used up for today. */
  exhausted: boolean;
  resetsAt: string;
};

export async function usageView(db: Db, userId: string, source: ModelSource): Promise<UsageView> {
  const today = await usageToday(db, userId);
  const shared = source === "hosted";
  const cap = shared ? dailyTokenCap() : null;
  const remaining = cap === null ? null : Math.max(0, cap - today.totalTokens);
  return { ...today, shared, capTokens: cap, remainingTokens: remaining, exhausted: cap !== null && today.totalTokens >= cap, resetsAt: nextUtcMidnight().toISOString() };
}

/** The meter for a user's LLMs: records every call; refuses calls on the shared key once today's cap is reached. */
export function meterForUser(db: Db, userId: string, source: ModelSource): Meter {
  return {
    before: source === "hosted" ? async () => {
      const cap = dailyTokenCap();
      if (cap === null) return;
      const { totalTokens } = await usageToday(db, userId);
      if (totalTokens >= cap) throw new LLMCapExceededError(totalTokens, cap);
    } : undefined,
    after: (u) => addUsage(db, userId, u),
  };
}
