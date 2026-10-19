import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { agentEvents, applications, channels, jobs, profiles } from "../db/schema.js";
import type { ApplyDriver, DriverContext, DriverResult, InboundMessage, OutboundMessage } from "../contracts.js";
import { ensureDefaultUser } from "../users.js";
import { ingestResume } from "../graph/ingest.js";
import { renderHtml } from "../tailor/template.js";
import { setLLM, type LLM } from "../llm/index.js";
import { createAgent, parseIntent, type RunnerDeps } from "../runner/index.js";
import { agentTick, announceWaiting, buildBrief, getActivity, loadPending, morningBrief, clearPendingMemory } from "./index.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments

Software Engineer | Brightside Analytics | Mar 2019 - Dec 2021
• Shipped a customer-facing React dashboard used by 1,200 customers

SKILLS
TypeScript, JavaScript, React, Node.js, PostgreSQL
`;
const JOB = `We are hiring a Senior Frontend Engineer to build our dashboard. Remote (US).
Requirements:
- Experience with React and TypeScript
- Node.js and PostgreSQL`;

class FakeDriver implements ApplyDriver {
  atsType = "web" as const;
  calls: DriverContext[] = [];
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    this.calls.push(ctx);
    const receipt = { fields: [{ label: "Email", value: ctx.profile.email, kind: "email" }], files: [ctx.resumePdfPath], submittedVia: "fake", dryRun: ctx.dryRun, durationMs: 1 };
    if (ctx.dryRun) return { outcome: "filled", receipt, fields: [] };
    return { outcome: "submitted", receipt: { ...receipt, confirmationText: "Thanks" } };
  }
}

let db: Db;
let userId: string;
let runner: RunnerDeps;
let driver: FakeDriver;
let sent: OutboundMessage[];
const notify = async (_u: string, m: OutboundMessage) => { sent.push(m); };
const msg = (text: string): InboundMessage => ({ channel: "telegram", address: "42", text });

async function addJob(company: string, extra = "", hoursAgo = 1) {
  const [row] = await db.insert(jobs).values({
    companyName: company, atsType: "web", externalId: `${company}-1`, title: "Senior Frontend Engineer", remote: true, location: "Remote",
    descriptionText: `${JOB}${extra ? `\n${extra}` : ""}`, applyUrl: `https://example.com/${company}`, postedAt: new Date(Date.now() - hoursAgo * 3600_000),
  }).returning();
  return row;
}
const statusOf = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0].status;

beforeEach(async () => {
  clearPendingMemory();
  db = await openTestDb();
  userId = (await ensureDefaultUser(db)).id;
  await ingestResume(db, userId, RESUME);
  await db.update(profiles).set({
    fullName: "Jordan Rivera", location: "San Francisco, CA", country: "US",
    workAuth: { authorizedUS: true, needsSponsorship: false, status: "visa", visaType: "H-1B" },
    autoApplyDailyCap: 2, autoApplyMinScore: 0.3, reviewBeforeSubmit: true, resumeAutoApprove: false,
  }).where(eq(profiles.userId, userId));
  await db.insert(channels).values({ userId, kind: "telegram", address: "42" });
  const root = await mkdtemp(path.join(os.tmpdir(), "jobgraph-agent-"));
  driver = new FakeDriver();
  runner = {
    pickDriver: () => driver, artifactsRoot: root, allowRealSubmit: true,
    render: async (content, outPath) => {
      await mkdir(path.dirname(outPath), { recursive: true }); await writeFile(outPath, "%PDF");
      return { html: renderHtml(content), pdfPath: outPath, pages: 1, atsScore: 85, atsChecks: [] };
    },
  };
  sent = [];
});
afterEach(() => setLLM(null));

describe("agentTick", () => {
  it("queues up to the cap, skips the citizenship job, asks for review, and advances on approve", async () => {
    await addJob("Stripe", "", 3);
    await addJob("Vercel", "", 2);
    await addJob("Anduril", "Must be a U.S. citizen due to government contracts.", 1);

    const s = await agentTick(db, userId, { runner, notify, parallelAvailable: () => false });
    expect(s.errors).toEqual([]);
    expect(s.scored).toBe(3);
    expect(s.queued).toBe(2);
    expect(s.skipped).toHaveLength(1);
    expect(s.skipped[0].job.companyName).toBe("Anduril");
    expect(s.skipped[0].reasons).toContain("Requires US citizenship");
    expect(s.awaitingReview).toBe(2);
    expect(s.announced).toBe(2);

    const events = await getActivity(db, userId, { limit: 50 });
    expect(events.filter((e) => e.kind === "review_requested")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "queued")).toHaveLength(2);
    const skipped = events.find((e) => e.kind === "skipped")!;
    expect(skipped.data).toMatchObject({ job: { companyName: "Anduril" }, reasons: ["Requires US citizenship"] });
    expect(events[0].ts.getTime()).toBeGreaterThanOrEqual(events[events.length - 1].ts.getTime());

    expect(sent).toHaveLength(2);
    const first = sent.find((m) => m.text.includes("approve 1"))!;
    expect(first.text).toMatch(/^Resume ready for Senior Frontend Engineer at (Stripe|Vercel)\.\n\d+ changes?, ATS 85, .*\nReply 'approve 1' or 'skip 1'\.\nhttp.*\/applications\//);
    expect(first.text.split("\n").length).toBeLessThanOrEqual(4);
    // The long form stays on the timeline for the web.
    const reviewEvent = (await getActivity(db, userId, { limit: 50 })).find((e) => e.kind === "review_requested")!;
    expect((reviewEvent.data as { long: string }).long).toMatch(/Reply 'approve \d' or 'skip \d'\. Open: /);
    expect(sent.some((m) => m.text.includes("approve 2"))).toBe(true);

    // A second tick neither re-queues, re-skips nor re-announces.
    const again = await agentTick(db, userId, { runner, notify, parallelAvailable: () => false });
    expect([again.queued, again.skipped.length, again.announced]).toEqual([0, 0, 0]);
    expect(sent).toHaveLength(2);

    // Approve #1 over chat: the resume gate opens and the runner fills the form.
    const pending = await loadPending(db, userId, msg("x"));
    expect(pending.map((p) => p.n)).toEqual([1, 2]);
    const agent = createAgent(db, { runner, notify, inline: true, useLLM: false });
    const reply = await agent(userId, msg("approve 1"));
    expect(reply.text).toMatch(/Approved the resume for Senior Frontend Engineer at/);
    expect(await statusOf(pending[0].applicationId)).toBe("form_review");
    expect(driver.calls[0].dryRun).toBe(true);
    const approved = await db.select().from(agentEvents).where(and(eq(agentEvents.userId, userId), eq(agentEvents.kind, "approved")));
    expect(approved).toHaveLength(1);

    // The filled form is announced once with the same reference number.
    expect(await announceWaiting(db, userId, notify)).toBe(1);
    expect(sent[2].text).toMatch(/^Application filled for .*\n.*\nReply 'approve 1' to submit or 'skip 1'/);

    const brief = morningBrief(await buildBrief(db, userId));
    expect(brief.text).toMatch(/2 started/);
    expect(brief.text).toMatch(/Waiting on you:\n1\. /);
  });

  it("respects the daily cap across ticks and the excluded-companies list", async () => {
    await db.update(profiles).set({ autoApplyDailyCap: 1, preferences: { excludeCompanies: ["Vercel"] } }).where(eq(profiles.userId, userId));
    await addJob("Stripe", "", 3);
    await addJob("Vercel", "", 2);
    await addJob("Linear", "", 1);
    const s = await agentTick(db, userId, { runner, notify, parallelAvailable: () => false, maxAdvance: 0 });
    expect(s.queued).toBe(1);
    expect(s.queuedJobs[0].companyName).toBe("Linear"); // newest first
    expect(s.skipped.map((x) => x.reasons[0])).toEqual(["Vercel is on your excluded companies list"]);
    expect((await agentTick(db, userId, { runner, notify, parallelAvailable: () => false, maxAdvance: 0 })).queued).toBe(0);
  });
});

describe("chat over the pending list", () => {
  async function twoWaiting() {
    await addJob("Stripe", "", 2);
    await addJob("Vercel", "", 1);
    await agentTick(db, userId, { runner, notify, parallelAvailable: () => false });
    const pending = await loadPending(db, userId, msg("x"));
    expect(pending.map((p) => p.company).sort()).toEqual(["Stripe", "Vercel"]);
    return Object.fromEntries(pending.map((p) => [p.company, p.applicationId]));
  }

  it("parses compound replies with the keyword fallback", () => {
    expect(parseIntent("skip the Stripe one, apply to the rest")).toEqual({
      kind: "act", actions: [{ tool: "skip", refs: ["stripe"] }, { tool: "approve", refs: ["rest"] }],
    });
    expect(parseIntent("approve 1 and 3")).toEqual({ kind: "act", actions: [{ tool: "approve", refs: ["1", "3"] }] });
    expect(parseIntent("skip 2")).toEqual({ kind: "skip", n: 2 });
    expect(parseIntent("set daily cap 5")).toEqual({ kind: "set", key: "daily_cap", value: "5" });
    expect(parseIntent("auto-approve off")).toEqual({ kind: "set", key: "auto_approve", value: "off" });
  });

  it("'skip the Stripe one, apply to the rest' resolves by company name (keyword fallback)", async () => {
    const ids = await twoWaiting();
    const agent = createAgent(db, { runner, notify, inline: true, useLLM: false });
    const reply = await agent(userId, msg("skip the Stripe one, apply to the rest"));
    expect(reply.text).toMatch(/Skipped Senior Frontend Engineer at Stripe/);
    expect(reply.text).toMatch(/Approved the resume for Senior Frontend Engineer at Vercel/);
    expect(await statusOf(ids.Stripe)).toBe("skipped");
    expect(await statusOf(ids.Vercel)).toBe("form_review");
    expect((await loadPending(db, userId, msg("x"))).map((p) => p.company)).toEqual(["Vercel"]);
  });

  it("uses LLM tool calls with the pending list and recent turns in the prompt", async () => {
    const ids = await twoWaiting();
    const prompts: string[] = [];
    const fake: LLM = {
      provider: "openai-compatible", model: "fake", available: true,
      async json(call) {
        if (call.name !== "agent_tools") throw new Error("not this test"); // other LLM users fall back to heuristics
        prompts.push(call.prompt);
        return call.schema.parse({ calls: [{ tool: "skip", refs: ["Stripe"] }, { tool: "approve", refs: ["rest"] }, { tool: "set_setting", key: "daily_cap", value: "4" }] });
      },
      async text() { return ""; },
    };
    setLLM(fake);
    const agent = createAgent(db, { runner, notify, inline: true });
    const reply = await agent(userId, msg("nah pass on stripe, go ahead with the others, and do 4 a day"));
    expect(prompts[0]).toMatch(/WAITING ON THE USER:\n1\. Senior Frontend Engineer at (Stripe|Vercel) \(resume_review\)/);
    expect(prompts[0]).toMatch(/USER: nah pass on stripe/);
    expect(await statusOf(ids.Stripe)).toBe("skipped");
    expect(await statusOf(ids.Vercel)).toBe("form_review");
    expect(reply.text).toMatch(/Done: your daily application cap is now 4 a day/);
    expect((await db.select().from(profiles).where(eq(profiles.userId, userId)))[0].autoApplyDailyCap).toBe(4);

    // Exact numbered commands skip the model.
    await agent(userId, msg("status"));
    expect(prompts).toHaveLength(1);
  });
});
