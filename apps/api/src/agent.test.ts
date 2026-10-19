import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ensureDefaultUser, ingestResume, jobs, openTestDb, profiles, renderHtml,
  type ApplyDriver, type DriverContext, type DriverResult, type Db, type OutboundMessage, type RenderFn,
} from "@jobgraph/core";
import { createApp } from "./app.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com

EXPERIENCE
Senior Software Engineer at Northwind Labs
Jan 2020 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service

SKILLS
TypeScript, React, Node.js, PostgreSQL
`;

class StubDriver implements ApplyDriver {
  atsType = "web" as const;
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    const receipt = { fields: [{ label: "Email", value: ctx.profile.email, kind: "email" }], files: [ctx.resumePdfPath], submittedVia: "stub", dryRun: ctx.dryRun, durationMs: 1 };
    return ctx.dryRun ? { outcome: "filled", receipt, fields: [] } : { outcome: "submitted", receipt };
  }
}
const stubRender: RenderFn = async (content, outPath) => {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, "%PDF-1.4 stub");
  return { html: renderHtml(content), pdfPath: outPath, pages: 1, atsScore: 88, atsChecks: [] };
};

let db: Db;
let app: ReturnType<typeof createApp>;
const sent: OutboundMessage[] = [];

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  db = await openTestDb();
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "jobgraph-api-agent-"));
  app = createApp(db, {
    runnerDeps: { pickDriver: () => new StubDriver(), render: stubRender, artifactsRoot, allowRealSubmit: true },
    mcp: false, defaultUserEmail: "me@example.com", notify: async (_u, m) => { sent.push(m); },
  });
  const user = await ensureDefaultUser(db, "me@example.com");
  await ingestResume(db, user.id, RESUME);
  await db.update(profiles).set({ autoApplyDailyCap: 2, autoApplyMinScore: 0.3, workAuth: { status: "visa", needsSponsorship: true } }).where(eq(profiles.userId, user.id));
  const desc = "Requirements:\n- React and TypeScript\n- Node.js and PostgreSQL";
  await db.insert(jobs).values([
    { companyName: "Vercel", atsType: "web", externalId: "v1", title: "Senior Frontend Engineer", remote: true, descriptionText: desc, applyUrl: "https://example.com/v1" },
    { companyName: "Initech", atsType: "web", externalId: "i1", title: "Frontend Engineer", remote: true, descriptionText: `${desc}\nWe do not offer visa sponsorship.`, applyUrl: "https://example.com/i1" },
  ]);
});

describe("agent api", () => {
  it("starts with an empty timeline and no tick", async () => {
    expect((await call("GET", "/api/agent/activity")).json).toEqual([]);
    const s = await call("GET", "/api/agent/status");
    expect(s.json).toMatchObject({ lastTickAt: null, nextTickAt: null, dailyCap: 2, usedToday: 0, minScore: 0.3, awaitingReview: [] });
  });

  it("POST /api/agent/tick runs a cycle in-process and fills activity and status", async () => {
    const t = await call("POST", "/api/agent/tick");
    expect(t.status).toBe(200);
    expect(t.json).toMatchObject({ queued: 1, awaitingReview: 1, errors: [] });
    expect(t.json.skipped[0]).toMatchObject({ job: { companyName: "Initech" }, reasons: ["No visa sponsorship offered and you need it"] });
    expect(sent[0].text).toMatch(/Resume ready for Senior Frontend Engineer at Vercel\.[\s\S]*Reply 'approve 1'/);

    const a = await call("GET", "/api/agent/activity?limit=10");
    const kinds = a.json.map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["scored", "queued", "skipped", "review_requested"]));
    expect(kinds[0]).toBe("review_requested"); // newest first
    const skipped = a.json.find((e: any) => e.kind === "skipped");
    expect(skipped.data).toMatchObject({ job: { title: "Frontend Engineer", companyName: "Initech" }, reasons: ["No visa sponsorship offered and you need it"] });
    expect(typeof skipped.ts).toBe("string");

    const s = await call("GET", "/api/agent/status");
    expect(s.json.lastTickAt).toBe(t.json.at);
    expect(Date.parse(s.json.nextTickAt) - Date.parse(s.json.lastTickAt)).toBe(20 * 60_000);
    expect(s.json.usedToday).toBe(1);
    expect(s.json.awaitingReview).toEqual([expect.objectContaining({ title: "Senior Frontend Engineer", companyName: "Vercel", atsScore: 88 })]);
  });

  it("POST /api/agent/chat uses the channel handler with memory", async () => {
    const r = await call("POST", "/api/agent/chat?wait=1", { text: "approve 1" });
    expect(r.json.reply).toMatch(/Approved the resume for Senior Frontend Engineer at Vercel/);
    expect((await call("GET", "/api/agent/status")).json.awaitingReview[0].status).toBe("form_review");
    const h = await call("GET", "/api/agent/chat");
    expect(h.json.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect((await call("GET", "/api/channels")).json).toEqual([]); // the web chat row is not a push channel
  });
});
