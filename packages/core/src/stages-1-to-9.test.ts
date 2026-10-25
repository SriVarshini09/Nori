import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb, type Db } from "./db/client.js";
import { applications, jobs, users } from "./db/schema.js";
import { setLLM } from "./llm/index.js";
import { ensureDefaultUser } from "./users.js";
import { ingestResume } from "./graph/ingest.js";
import { buildGoogleAuthUrl, upsertGoogleUser } from "./auth/oauth.js";
import { decryptVaultSecret, encryptVaultSecret, generateAtsPassword, getOrCreateAtsAccount, listAtsAccounts } from "./auth/vault.js";
import { listPushSubscriptions, removePushSubscription, savePushSubscription } from "./push/index.js";
import {
  classifyInboundMail,
  ensureInboundEmail,
  extractOtpFromMail,
  handleInboundEmailWebhook,
  markGhostedApplications,
} from "./mail/inbound.js";
import { getPlanStatus, handleStripeWebhookEvent, verifyStripeWebhookSignature } from "./billing/index.js";
import { findAndDraftOutreach, markOutreachSent } from "./research/outreach.js";
import { FLUFF_RE } from "./tailor/fluff.js";

let db: Db;
let userId: string;

beforeAll(async () => {
  setLLM({ provider: "none", model: "none", available: false, json: async () => { throw new Error("none"); }, text: async () => { throw new Error("none"); } });
  db = await openTestDb();
  const u = await ensureDefaultUser(db, "stages@example.com");
  userId = u.id;
  await ingestResume(
    db,
    userId,
    `Maya Chen\nmaya@example.com\n\nEXPERIENCE\nSenior Engineer at Acme (2022 - Present)\n- Built distributed Rust and TypeScript services reducing p99 latency by 42%\n\nSKILLS\nRust, TypeScript, Go, Kubernetes`,
  );
});

describe("Stage 1: Google OAuth & Web Push subscriptions", () => {
  it("creates and links a verified user from Google OAuth", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    const url = buildGoogleAuthUrl("https://jobs.norinote.xyz/api/auth/google/callback", "/dashboard");
    expect(url).toContain("client_id=test-google-client-id");

    const { user: u1, isNew: new1 } = await upsertGoogleUser(db, {
      sub: "g-123",
      email: "oauth-user@example.com",
      name: "OAuth Tester",
      email_verified: true,
    });
    expect(new1).toBe(true);
    expect(u1.emailVerifiedAt).toBeInstanceOf(Date);

    // Second sign-in reuses the same account
    const { user: u2, isNew: new2 } = await upsertGoogleUser(db, {
      sub: "g-123",
      email: "oauth-user@example.com",
      name: "OAuth Tester",
    });
    expect(new2).toBe(false);
    expect(u2.id).toBe(u1.id);
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("saves, lists, and removes Web Push subscriptions", async () => {
    const saved = await savePushSubscription(
      db,
      userId,
      { endpoint: "https://fcm.googleapis.com/fcm/send/sub-1", keys: { p256dh: "k1", auth: "a1" } },
      "Mozilla/5.0 iPhone",
    );
    expect(saved.endpoint).toContain("sub-1");
    expect(await listPushSubscriptions(db, userId)).toHaveLength(1);
    expect(await removePushSubscription(db, userId, "https://fcm.googleapis.com/fcm/send/sub-1")).toBe(true);
    expect(await listPushSubscriptions(db, userId)).toHaveLength(0);
  });
});

describe("Stage 3 & 9: Owned Inbound Email (@mail.norinote.xyz) & Ghosted Tracker Stage", () => {
  it("generates a stable owned inbound address and processes verification codes, confirmations, and status updates", async () => {
    const addr = await ensureInboundEmail(db, userId);
    expect(addr).toMatch(/@mail\.norinote\.xyz$/);
    expect(await ensureInboundEmail(db, userId)).toBe(addr);

    expect(extractOtpFromMail("Your Greenhouse security code", "Enter verification code 739201 to submit.")).toBe("739201");
    expect(classifyInboundMail("Invitation to interview at Waymo", "Let's schedule a phone screen.")).toEqual({
      kind: "interview",
      code: null,
    });

    const [job] = await db
      .insert(jobs)
      .values({
        companyName: "Waymo",
        atsType: "greenhouse",
        externalId: "waymo-1",
        title: "Systems Engineer",
        descriptionText: "Rust and C++",
        applyUrl: "https://boards.greenhouse.io/waymo/jobs/1",
      })
      .returning();
    const [app] = await db
      .insert(applications)
      .values({ userId, jobId: job!.id, status: "submitted", submittedAt: new Date(Date.now() - 20 * 86_400_000), updatedAt: new Date(Date.now() - 20 * 86_400_000) })
      .returning();

    // 1. Before any reply, 20-day-old submitted application can be marked ghosted
    const ghostedCount = await markGhostedApplications(db, 14);
    expect(ghostedCount).toBeGreaterThanOrEqual(1);
    const [afterGhost] = await db.select().from(applications).where(eq(applications.id, app!.id));
    expect(afterGhost?.status).toBe("ghosted");

    // 2. Inbound interview invite to the owned address links to the application and moves status to interview!
    const wh = await handleInboundEmailWebhook(db, {
      id: "resend-msg-1",
      from: "recruiting@waymo.com",
      to: addr,
      subject: "Waymo — Schedule an interview for Systems Engineer",
      text: "Hi Maya, we would love to schedule an interview with you this week.",
    });
    expect(wh).toMatchObject({ matched: true, kind: "interview", applicationId: app!.id });
    const [afterInterview] = await db.select().from(applications).where(eq(applications.id, app!.id));
    expect(afterInterview?.status).toBe("interview");
  });
});

describe("Stage 5: Encrypted Per-Employer ATS Account Vault", () => {
  it("encrypts/decrypts secrets and reuses per-employer credentials on second application", async () => {
    const pw = generateAtsPassword();
    expect(pw).toHaveLength(16);
    const enc = encryptVaultSecret(pw);
    expect(decryptVaultSecret(enc)).toBe(pw);

    const first = await getOrCreateAtsAccount(db, userId, "workday", "nvidia", "maya@mail.norinote.xyz");
    expect(first.created).toBe(true);
    expect(first.password).toHaveLength(16);

    const second = await getOrCreateAtsAccount(db, userId, "workday", "NVIDIA", "maya@mail.norinote.xyz");
    expect(second.created).toBe(false);
    expect(second.password).toBe(first.password);

    const list = await listAtsAccounts(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0]?.employerKey).toBe("nvidia");
  });
});

describe("Stage 6: Plans, Stripe Webhook Verification & Billing", () => {
  it("tracks plan limits and upgrades/downgrades via Stripe webhook events", async () => {
    const initial = await getPlanStatus(db, userId);
    expect(initial.plan).toBe("free");
    expect(initial.limits.dailyApplicationsCap).toBe(3);

    const secret = "whsec_test_secret";
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: userId, customer: "cus_123", subscription: "sub_123" } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(verifyStripeWebhookSignature(body, `t=${ts},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeWebhookSignature(body, `t=${ts},v1=deadbeef`, secret)).toBe(false);

    await handleStripeWebhookEvent(db, JSON.parse(body));
    const upgraded = await getPlanStatus(db, userId);
    expect(upgraded.plan).toBe("pro");
    expect(upgraded.limits.dailyApplicationsCap).toBe(20);

    await handleStripeWebhookEvent(db, {
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_123", status: "canceled" } },
    });
    const downgraded = await getPlanStatus(db, userId);
    expect(downgraded.plan).toBe("free");
  });
});

describe("Stage 7: People Outreach Drafter", () => {
  it("drafts provenance-backed outreach notes with zero fluff and sets a 5-day follow-up reminder on send", async () => {
    const [job] = await db
      .insert(jobs)
      .values({
        companyName: "Anthropic",
        atsType: "greenhouse",
        externalId: "anth-1",
        title: "Distributed Systems Engineer",
        descriptionText: "Requirements: Rust, TypeScript, Kubernetes",
        applyUrl: "https://boards.greenhouse.io/anthropic/jobs/1",
      })
      .returning();

    const contacts = await findAndDraftOutreach(db, userId, job!.id);
    expect(contacts.length).toBeGreaterThanOrEqual(3);
    for (const c of contacts) {
      expect(c.companyName).toBe("Anthropic");
      expect(FLUFF_RE.test(c.draftText)).toBe(false);
      expect(c.draftText).toMatch(/Rust|TypeScript|42%/);
    }

    const sent = await markOutreachSent(db, userId, contacts[0]!.id);
    expect(sent?.status).toBe("sent");
    expect(sent?.followUpAt).toBeInstanceOf(Date);
    expect((await db.select().from(users).where(eq(users.id, userId))).length).toBe(1);
  });
});
