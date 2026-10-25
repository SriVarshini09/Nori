import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  applications,
  inboxMessages,
  jobs,
  profiles,
  users,
  type ApplicationStatus,
  type InboxKind,
} from "../db/schema.js";
import { htmlToText } from "../feeds/html.js";

/**
 * Stage 3: Owned Inbound Email (`firstname-xxxx@mail.norinote.xyz`) + Stage 9 Ghosted Tracker Stage.
 *
 * Each user gets a dedicated inbound address on `INBOUND_EMAIL_DOMAIN` (default `mail.norinote.xyz`).
 * Verification codes, application confirmations, interview invites, offers, and rejections sent to
 * that address arrive via `/api/webhooks/resend`, are classified deterministically, linked to the
 * matching application, and advance the tracker status without requiring Gmail OAuth.
 */

export function inboundEmailDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN?.trim() || "mail.norinote.xyz";
}

export function deriveInboundEmail(nameOrEmail: string, userId: string): string {
  const base = nameOrEmail
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18) || "applicant";
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 6);
  return `${base}-${hash}@${inboundEmailDomain()}`;
}

/** Ensure the user's profile has a unique owned inbound email address (`firstname-xxxx@mail.norinote.xyz`). */
export async function ensureInboundEmail(db: Db, userId: string): Promise<string> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (profile?.inboundEmail) return profile.inboundEmail;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const seed = profile?.fullName || user?.name || user?.email || "nori";
  const address = deriveInboundEmail(seed, userId);
  await db.update(profiles).set({ inboundEmail: address, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  return address;
}

const OTP_CONTEXT_RE = /\b(verification|verify|security|confirmation|passcode|one[- ]time|otp|code|pin)\b/i;
const OTP_CODE_RE = /\b(\d{6,8}|[A-Z0-9]{6,8})\b/g;

export function extractOtpFromMail(subject: string, bodyText: string): string | null {
  const combined = `${subject}\n${bodyText.slice(0, 2000)}`;
  if (!OTP_CONTEXT_RE.test(combined)) return null;
  // Prefer 6-8 digit numeric codes first, then alphanumeric codes with at least one digit (e.g. Greenhouse 8-char codes)
  const numeric = /\b(\d{6,8})\b/.exec(combined);
  if (numeric?.[1]) return numeric[1];
  for (const m of combined.matchAll(OTP_CODE_RE)) {
    const token = m[1]!;
    if (/\d/.test(token) && !/^(19|20)\d{2}$/.test(token)) return token;
  }
  return null;
}

export function classifyInboundMail(subject: string, bodyText: string): { kind: InboxKind; code: string | null } {
  const code = extractOtpFromMail(subject, bodyText);
  if (code) return { kind: "verification_code", code };

  const text = `${subject}\n${bodyText.slice(0, 2500)}`.toLowerCase();
  if (/\b(unfortunately|not moving forward|other candidates|decided not to proceed|will not be moving forward|not selected|regret to inform)\b/.test(text)) {
    return { kind: "rejection", code: null };
  }
  if (/\b(pleased to offer|job offer|formal offer|offer letter|excited to extend an offer)\b/.test(text)) {
    return { kind: "offer", code: null };
  }
  if (/\b(schedule an? (?:interview|call|chat)|phone screen|technical interview|invite you to interview|availability for a (?:call|chat|interview)|calendly\.com)\b/.test(text)) {
    return { kind: "interview", code: null };
  }
  if (/\b(thank you for applying|application received|received your application|thanks for applying|confirming your application)\b/.test(text)) {
    return { kind: "confirmation", code: null };
  }
  if (/\b(recruiter|talent acquisition|hiring manager|your application to|opportunity at)\b/.test(text)) {
    return { kind: "recruiter_reply", code: null };
  }
  return { kind: "other", code: null };
}

export type ResendInboundPayload = {
  id?: string;
  from: string;
  to: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  created_at?: string;
};

const STATUS_FOR_KIND: Partial<Record<InboxKind, ApplicationStatus>> = {
  rejection: "rejected",
  interview: "interview",
  offer: "offer",
  recruiter_reply: "replied",
};

/**
 * Process an inbound email webhook (Resend / Postmark / Cloudflare Email Routing shape).
 * Matches the recipient address to a user's `inboundEmail` (or primary email), classifies the message,
 * links it to the most recent matching application by company name, and updates the application stage.
 */
export async function handleInboundEmailWebhook(
  db: Db,
  payload: ResendInboundPayload,
): Promise<{ matched: boolean; messageId?: string; kind?: InboxKind; code?: string | null; applicationId?: string | null }> {
  const recipients = (Array.isArray(payload.to) ? payload.to : [payload.to])
    .flatMap((r) => String(r ?? "").split(","))
    .map((r) => {
      const m = /<([^>]+)>/.exec(r);
      return (m ? m[1]! : r).trim().toLowerCase();
    })
    .filter(Boolean);

  if (!recipients.length) return { matched: false };

  let userId: string | null = null;
  for (const addr of recipients) {
    const [prof] = await db.select({ userId: profiles.userId }).from(profiles).where(sql`lower(${profiles.inboundEmail}) = ${addr}`).limit(1);
    if (prof) {
      userId = prof.userId;
      break;
    }
    const [usr] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${addr}`).limit(1);
    if (usr) {
      userId = usr.id;
      break;
    }
  }
  if (!userId) return { matched: false };

  const subject = (payload.subject ?? "(no subject)").trim();
  const bodyText = (payload.text?.trim() || htmlToText(payload.html ?? "")).slice(0, 50_000);
  const { kind, code } = classifyInboundMail(subject, bodyText);

  // Match to an application for this user by company name in From or Subject
  let applicationId: string | null = null;
  if (kind !== "other") {
    const userApps = await db
      .select({ id: applications.id, status: applications.status, companyName: jobs.companyName })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.updatedAt))
      .limit(50);

    const hay = `${payload.from} ${subject} ${bodyText.slice(0, 600)}`.toLowerCase();
    const matchedApp = userApps.find((a) => {
      const co = a.companyName.trim().toLowerCase();
      return co.length >= 2 && hay.includes(co);
    });
    if (matchedApp) {
      applicationId = matchedApp.id;
      const nextStatus = STATUS_FOR_KIND[kind];
      if (nextStatus && ["submitted", "viewed", "replied", "ghosted"].includes(matchedApp.status)) {
        await db.update(applications).set({ status: nextStatus, updatedAt: new Date() }).where(eq(applications.id, matchedApp.id));
      }
    }
  }

  const externalId = payload.id?.trim() || `resend:${createHash("sha1").update(`${payload.from}|${subject}|${bodyText.slice(0, 200)}`).digest("hex")}`;
  const [inserted] = await db
    .insert(inboxMessages)
    .values({
      userId,
      applicationId,
      externalId,
      fromAddress: payload.from.trim(),
      subject,
      bodyText,
      receivedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
      kind,
      code,
      source: "resend_inbound",
    })
    .onConflictDoUpdate({
      target: [inboxMessages.userId, inboxMessages.externalId],
      set: { kind, code, applicationId },
    })
    .returning();

  return { matched: true, messageId: inserted?.id, kind, code, applicationId };
}

/**
 * Stage 9: Move submitted applications with no reply after `daysWithoutReply` (default 14 days) to `ghosted`.
 */
export async function markGhostedApplications(db: Db, daysWithoutReply = 14): Promise<number> {
  const cutoff = new Date(Date.now() - daysWithoutReply * 86_400_000);
  const candidates = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        inArray(applications.status, ["submitted", "viewed"] as ApplicationStatus[]),
        lt(applications.submittedAt, cutoff),
        isNull(
          db
            .select({ id: inboxMessages.id })
            .from(inboxMessages)
            .where(
              and(
                eq(inboxMessages.applicationId, applications.id),
                inArray(inboxMessages.kind, ["recruiter_reply", "interview", "offer", "rejection"] as InboxKind[]),
              ),
            )
            .limit(1) as any,
        ),
      ),
    )
    .catch(() => [] as { id: string }[]);

  if (!candidates.length) {
    // Simple fallback query compatible with both PGlite and Postgres
    const stale = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(inArray(applications.status, ["submitted", "viewed"] as ApplicationStatus[]), lt(applications.updatedAt, cutoff)));
    let moved = 0;
    for (const s of stale) {
      const replies = await db
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.applicationId, s.id),
            inArray(inboxMessages.kind, ["recruiter_reply", "interview", "offer", "rejection"] as InboxKind[]),
          ),
        )
        .limit(1);
      if (replies.length === 0) {
        await db.update(applications).set({ status: "ghosted", updatedAt: new Date() }).where(eq(applications.id, s.id));
        moved++;
      }
    }
    return moved;
  }

  const updated = await db
    .update(applications)
    .set({ status: "ghosted", updatedAt: new Date() })
    .where(inArray(applications.id, candidates.map((c) => c.id)))
    .returning();
  return updated.length;
}
