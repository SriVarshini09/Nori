import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
}

export async function savePushSubscription(
  db: Db,
  userId: string,
  sub: PushSubscriptionInput,
  userAgent?: string,
): Promise<{ id: string; endpoint: string }> {
  const endpoint = sub.endpoint.trim();
  const p256dh = sub.keys.p256dh.trim();
  const auth = sub.keys.auth.trim();
  if (!endpoint || !p256dh || !auth) throw new Error("Invalid push subscription");

  const [row] = await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth, userAgent: userAgent ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh, auth, userAgent: userAgent ?? null },
    })
    .returning();
  return { id: row!.id, endpoint: row!.endpoint };
}

export async function removePushSubscription(db: Db, userId: string, endpoint: string): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint.trim())))
    .returning();
  return deleted.length > 0;
}

export async function listPushSubscriptions(
  db: Db,
  userId: string,
): Promise<(typeof pushSubscriptions.$inferSelect)[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}
