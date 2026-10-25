import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, users, type UserPlan } from "../db/schema.js";

/**
 * Stage 6: Plans, Stripe Checkout/Portal/Webhooks, and Referral Codes.
 *
 * Free plan: 3 applications/day, 2 lanes, 300,000 daily model tokens.
 * Pro plan: 20 applications/day, unlimited lanes, Autopilot, 1,500,000 daily model tokens.
 */

export type PlanLimits = {
  plan: UserPlan;
  dailyApplicationsCap: number;
  maxLanes: number;
  dailyTokenCap: number;
  autopilotIncluded: boolean;
};

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    plan: "free",
    dailyApplicationsCap: 3,
    maxLanes: 2,
    dailyTokenCap: 300_000,
    autopilotIncluded: false,
  },
  pro: {
    plan: "pro",
    dailyApplicationsCap: 20,
    maxLanes: 20,
    dailyTokenCap: 1_500_000,
    autopilotIncluded: true,
  },
};

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function deriveReferralCode(userId: string): string {
  return `nori-${createHash("sha256").update(userId).digest("hex").slice(0, 8)}`;
}

export type PlanStatus = {
  plan: UserPlan;
  limits: PlanLimits;
  usedToday: number;
  remainingToday: number;
  referralCode: string;
  stripeConfigured: boolean;
  hasCustomer: boolean;
};

export async function getPlanStatus(db: Db, userId: string): Promise<PlanStatus> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const plan: UserPlan = user?.plan === "pro" ? "pro" : "free";
  const limits = PLAN_LIMITS[plan];

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [{ n }] = await db
    .select({ n: count() })
    .from(applications)
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, dayStart)));
  const usedToday = Number(n);
  const referralCode = user?.referralCode || deriveReferralCode(userId);
  if (user && !user.referralCode) {
    await db.update(users).set({ referralCode }).where(eq(users.id, userId));
  }

  return {
    plan,
    limits,
    usedToday,
    remainingToday: Math.max(0, limits.dailyApplicationsCap - usedToday),
    referralCode,
    stripeConfigured: stripeConfigured(),
    hasCustomer: Boolean(user?.stripeCustomerId),
  };
}

export async function createStripeCheckoutSession(
  user: { id: string; email: string; stripeCustomerId?: string | null },
  returnUrl: string,
): Promise<{ url: string; id: string }> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRO_PRICE_ID?.trim();
  if (!key || !priceId) throw new Error("Stripe billing is not configured on this server (STRIPE_SECRET_KEY / STRIPE_PRO_PRICE_ID)");

  const params = new URLSearchParams({
    mode: "subscription",
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=canceled`,
    client_reference_id: user.id,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
  });
  if (user.stripeCustomerId) params.set("customer", user.stripeCustomerId);
  else params.set("customer_email", user.email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Stripe checkout failed: ${res.status}`);
  const data = (await res.json()) as { id: string; url: string };
  return { id: data.id, url: data.url };
}

export async function createStripePortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe billing is not configured on this server");
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ customer: customerId, return_url: returnUrl }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Stripe portal failed: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return { url: data.url };
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.trim().split("=");
      return [k, v];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function handleStripeWebhookEvent(
  db: Db,
  event: { type: string; data?: { object?: Record<string, any> } },
): Promise<{ updatedUserId?: string; plan?: UserPlan }> {
  const obj = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    const userId = obj.client_reference_id as string | undefined;
    const customerId = obj.customer as string | undefined;
    const subscriptionId = obj.subscription as string | undefined;
    if (userId) {
      await db
        .update(users)
        .set({
          plan: "pro",
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
        })
        .where(eq(users.id, userId));
      return { updatedUserId: userId, plan: "pro" };
    }
  }
  if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
    const customerId = obj.customer as string | undefined;
    const status = obj.status as string | undefined;
    if (customerId) {
      const nextPlan: UserPlan = status === "active" || status === "trialing" ? "pro" : "free";
      const [u] = await db
        .update(users)
        .set({ plan: nextPlan })
        .where(eq(users.stripeCustomerId, customerId))
        .returning();
      return { updatedUserId: u?.id, plan: nextPlan };
    }
  }
  return {};
}
