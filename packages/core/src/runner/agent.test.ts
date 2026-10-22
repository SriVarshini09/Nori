import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import { applications, channels } from "../db/schema.js";
import type { ApplyDriver, InboundMessage, NormalizedJob } from "../contracts.js";
import { ensureDefaultUser } from "../users.js";
import { upsertJobs } from "../feeds/normalize.js";
import { ingestResume } from "../graph/ingest.js";
import { renderHtml } from "../tailor/template.js";
import { createAgent, parseIntent, runApplication, type RunnerDeps } from "./index.js";

describe("parseIntent", () => {
  it("parses the plain-text commands", () => {
    expect(parseIntent("find senior react roles, remote")).toEqual({ kind: "find", objective: "senior react roles, remote" });
    expect(parseIntent("apply to 2")).toEqual({ kind: "apply", n: 2 });
    expect(parseIntent("Apply #3")).toEqual({ kind: "apply", n: 3 });
    expect(parseIntent("status")).toEqual({ kind: "status" });
    expect(parseIntent("approve resume")).toEqual({ kind: "approve", n: undefined, what: "resume" });
    expect(parseIntent("approve 1")).toEqual({ kind: "approve", n: 1, what: undefined });
    expect(parseIntent("missing 4")).toEqual({ kind: "missing", n: 4 });
    expect(parseIntent("research 1")).toEqual({ kind: "research", n: 1 });
    expect(parseIntent("fact: I speak Spanish")).toEqual({ kind: "fact", text: "I speak Spanish" });
    expect(parseIntent("I led a team of 5 at Acme")).toEqual({ kind: "fact", text: "I led a team of 5 at Acme" });
    expect(parseIntent("what is the weather")).toBeNull();
  });
});

describe("agent", () => {
  it("find -> apply -> approve through the shortlist", async () => {
    const db = await openTestDb();
    const user = await ensureDefaultUser(db);
    await ingestResume(db, user.id, "Sam Lee\nsam@example.com\n\nEXPERIENCE\nSoftware Engineer at Initech\nJan 2020 - Present\n• Built React and TypeScript dashboards used by 500 customers\n\nSKILLS\nReact, TypeScript");
    await db.insert(channels).values({ userId: user.id, kind: "telegram", address: "42" });
    const fakeJob: NormalizedJob = {
      atsType: "web", externalId: "x1", companyName: "Initrode", title: "Frontend Engineer", remote: true,
      descriptionText: "Requirements:\n- React\n- TypeScript", applyUrl: "https://example.com/x1", discoveredVia: "parallel_search",
    };
    const discover = async (d: typeof db) => ({ ...(await upsertJobs(d, [fakeJob])), jobs: [fakeJob] });
    const driver: ApplyDriver = { atsType: "web", supports: () => true, run: async () => ({ outcome: "failed", error: "unused" }) };
    const runner: RunnerDeps = {
      pickDriver: () => driver, artifactsRoot: path.join(os.tmpdir(), "jobgraph-agent"),
      render: async (content, outPath) => {
        await mkdir(path.dirname(outPath), { recursive: true }); await writeFile(outPath, "%PDF");
        return { html: renderHtml(content), pdfPath: outPath, pages: 1, atsScore: 90, atsChecks: [] };
      },
    };
    const notes: string[] = [];
    const agent = createAgent(db, { runner, discover, notify: async (_u, m) => { notes.push(m.text); } });
    const msg = (text: string): InboundMessage => ({ channel: "telegram", address: "42", text });

    const found = await agent(user.id, msg("find frontend roles"));
    expect(found.text).toMatch(/^1\. Frontend Engineer - Initrode \(\d+%\)/);

    const applied = await agent(user.id, msg("apply 1"));
    expect(applied.text).toMatch(/Started: Frontend Engineer at Initrode/);
    const [app] = await db.select().from(applications).where(eq(applications.userId, user.id));
    expect(await runApplication(db, app.id, runner)).toBe("resume_review"); // waits for the background run
    await new Promise((r) => setTimeout(r, 50));
    expect(notes.some((n) => /resume ready for review/.test(n))).toBe(true);

    expect((await agent(user.id, msg("status"))).text).toMatch(/resume_review: 1/);
    expect((await agent(user.id, msg("apply 9"))).text).toMatch(/No item 9/);
    expect((await agent(user.id, msg("blah blah"))).text).toMatch(/Commands:/);
  });
});

describe("agent without live web search", () => {
  it("answers find from the jobs it already holds instead of failing", async () => {
    const db = await openTestDb();
    const user = await ensureDefaultUser(db);
    const resume = ["Sam Lee", "sam@example.com", "", "EXPERIENCE", "Software Engineer at Initech", "Jan 2020 - Present", "• Built React and TypeScript dashboards used by 500 customers", "", "SKILLS", "React, TypeScript"].join("\n");
    await ingestResume(db, user.id, resume);
    await db.insert(channels).values({ userId: user.id, kind: "telegram", address: "42" });
    const held: NormalizedJob[] = [
      { atsType: "web", externalId: "h1", companyName: "Initrode", title: "Staff Frontend Engineer", remote: true, descriptionText: ["Requirements:", "- React", "- TypeScript"].join("\n"), applyUrl: "https://example.com/h1", discoveredVia: "feed" },
      { atsType: "web", externalId: "h2", companyName: "Hooli", title: "Registered Nurse", remote: false, descriptionText: ["Requirements:", "- RN license"].join("\n"), applyUrl: "https://example.com/h2", discoveredVia: "feed" },
    ];
    await upsertJobs(db, held);
    const off = async () => { throw new Error("PARALLEL_API_KEY is not set; Parallel search/extract/research is unavailable"); };
    const agent = createAgent(db, { runner: { pickDriver: () => null as never, artifactsRoot: path.join(os.tmpdir(), "jobgraph-agent") }, discover: off as never, notify: async () => {} });
    const r = await agent(user.id, { channel: "telegram", address: "42", text: "find staff frontend roles, remote" });
    expect(r.text).toMatch(/Staff Frontend Engineer - Initrode/);
    expect(r.text).not.toMatch(/Registered Nurse/);
    expect(r.text).not.toMatch(/PARALLEL_API_KEY/);
  });
});

describe("guardModelActions", () => {
  it("drops approvals and setting changes the person's own words do not ask for", async () => {
    const { guardModelActions } = await import("./agent.js");
    const injected = [
      { tool: "approve" as const, refs: ["all"], what: "form" as const },
      { tool: "set_setting" as const, key: "review_before_submit" as const, value: "off" },
      { tool: "status" as const },
    ];
    const r = guardModelActions("what's new today?", injected);
    expect(r.actions).toEqual([{ tool: "status" }]);
    expect(r.dropped.map((a) => a.tool)).toEqual(["approve", "set_setting"]);
    expect(guardModelActions("go ahead with the Stripe one", [injected[0]]).actions).toHaveLength(1);
    expect(guardModelActions("stop asking me to review forms", [injected[1]]).actions).toHaveLength(1);
    expect(guardModelActions("set my daily cap to 5", [injected[1]]).actions).toHaveLength(0);
  });
});
