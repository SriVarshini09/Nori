import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { agentEvents, applications, jobs, profiles, type Lane } from "../db/schema.js";
import type { ApplyDriver, DriverContext, DriverResult } from "../contracts.js";
import { ensureDefaultUser } from "../users.js";
import { ingestResume } from "../graph/ingest.js";
import { setLLM } from "../llm/index.js";
import { computeMatchesForUser } from "../runner/jobs.js";
import { renderHtml } from "../tailor/template.js";
import type { RunnerDeps } from "../runner/index.js";
import { agentTick } from "./loop.js";
import { effectiveLanes, laneFor, lanesFor, locationMatches, normalizeLanes, queuedTodayByLane, titleMatches } from "./lanes.js";

const lane = (over: Partial<Lane>): Lane => ({ id: "l", name: "L", titles: [], locations: [], remote: "ok", minScore: 0.3, enabled: true, ...over });

describe("lane matching", () => {
  it("matches titles by substring, word set, abbreviations and canonical skills", () => {
    expect(titleMatches("Senior Frontend Engineer, Growth", "Senior Frontend Engineer")).toBe(true);
    expect(titleMatches("Senior Software Engineer, Frontend", "Senior Frontend Engineer")).toBe(true);
    expect(titleMatches("Sr. Front-End Engineer", "senior frontend engineer")).toBe(true);
    expect(titleMatches("Staff Engineer, Infrastructure", "Staff Engineer")).toBe(true);
    expect(titleMatches("Software Engineer (ReactJS)", "React Engineer")).toBe(true);
    expect(titleMatches("Backend Engineer", "Senior Frontend Engineer")).toBe(false);
    expect(titleMatches("Product Designer", "Staff Engineer")).toBe(false);
  });

  it("checks location and remote constraints", () => {
    expect(locationMatches("San Francisco, CA", ["San Francisco"])).toBe(true);
    expect(locationMatches("SF Bay Area", ["San Francisco"])).toBe(true);
    expect(locationMatches("New York, NY", ["San Francisco"])).toBe(false);
    const sf = lane({ titles: ["Frontend Engineer"], locations: ["San Francisco"], remote: "ok" });
    expect(lanesFor({ title: "Frontend Engineer", location: "San Francisco, CA" }, [sf])).toHaveLength(1);
    expect(lanesFor({ title: "Frontend Engineer", location: "Remote - US", remote: true }, [sf])).toHaveLength(1);
    expect(lanesFor({ title: "Frontend Engineer", location: "London" }, [sf])).toHaveLength(0);
    const remoteOnly = lane({ remote: "only" });
    expect(laneFor({ title: "Anything", location: "Austin, TX" }, [remoteOnly])).toBeNull();
    expect(laneFor({ title: "Anything", location: "Remote" }, [remoteOnly])).not.toBeNull();
    const onsite = lane({ remote: "no", locations: ["New York"] });
    expect(laneFor({ title: "X", location: "New York, NY" }, [onsite])).not.toBeNull();
    expect(laneFor({ title: "X", location: "Remote", remote: true }, [onsite])).toBeNull();
  });

  it("picks the first enabled lane whose minScore the job reaches", () => {
    const strict = lane({ id: "strict", titles: ["Engineer"], minScore: 0.8 });
    const loose = lane({ id: "loose", titles: ["Engineer"], minScore: 0.4 });
    const off = lane({ id: "off", titles: ["Engineer"], enabled: false, minScore: 0 });
    expect(laneFor({ title: "Staff Engineer" }, [off, strict, loose], 0.9)?.id).toBe("strict");
    expect(laneFor({ title: "Staff Engineer" }, [off, strict, loose], 0.5)?.id).toBe("loose");
    expect(laneFor({ title: "Staff Engineer" }, [off, strict, loose], 0.1)).toBeNull();
  });

  it("normalizes input: ids from names, percentages, defaults", () => {
    const out = normalizeLanes([{ name: "Senior Frontend", titles: ["Senior Frontend Engineer"], minScore: 60 }, { name: "Senior Frontend" }]);
    expect(out.map((l) => l.id)).toEqual(["senior-frontend", "senior-frontend-2"]);
    expect(out[0]).toMatchObject({ minScore: 0.6, remote: "ok", enabled: true, locations: [] });
    expect(() => normalizeLanes([{ name: "" }])).toThrow();
  });

  it("falls back to preferences.titles as one implicit lane", () => {
    const lanes = effectiveLanes({ preferences: { titles: ["Staff Engineer"] }, autoApplyMinScore: 0.5 });
    expect(lanes).toEqual([expect.objectContaining({ id: "default", titles: ["Staff Engineer"], minScore: 0.5, implicit: true })]);
  });
});

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2018 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments

SKILLS
TypeScript, JavaScript, React, Node.js, PostgreSQL
`;
const DESC = `Requirements:\n- Experience with React and TypeScript\n- Node.js and PostgreSQL`;

class FakeDriver implements ApplyDriver {
  atsType = "web" as const;
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    return { outcome: "filled", receipt: { fields: [], files: [ctx.resumePdfPath], submittedVia: "fake", dryRun: true, durationMs: 1 }, fields: [] };
  }
}

describe("agentTick with lanes", () => {
  let db: Db;
  let userId: string;
  let runner: RunnerDeps;

  beforeEach(async () => {
    db = await openTestDb();
    userId = (await ensureDefaultUser(db)).id;
    await ingestResume(db, userId, RESUME);
    const root = await mkdtemp(path.join(os.tmpdir(), "jobgraph-lanes-"));
    runner = {
      pickDriver: () => new FakeDriver(), artifactsRoot: root, allowRealSubmit: false,
      render: async (content, outPath) => {
        await mkdir(path.dirname(outPath), { recursive: true }); await writeFile(outPath, "%PDF");
        return { html: renderHtml(content), pdfPath: outPath, pages: 1, atsScore: 80, atsChecks: [] };
      },
    };
  });

  async function addJob(company: string, title: string, location: string, remote = false, hoursAgo = 1, extra = "") {
    await db.insert(jobs).values({
      companyName: company, atsType: "web", externalId: `${company}-${title}`, title, location, remote,
      descriptionText: DESC + extra, applyUrl: `https://example.com/${company}`, postedAt: new Date(Date.now() - hoursAgo * 3600_000),
    });
  }

  it("two lanes share a daily cap of 3; jobs outside every lane are ignored", async () => {
    const lanes = normalizeLanes([
      { name: "Frontend SF", titles: ["Senior Frontend Engineer"], locations: ["San Francisco"], remote: "ok", minScore: 0.3 },
      { name: "Staff", titles: ["Staff Engineer"], locations: [], remote: "only", minScore: 0.3 },
    ]);
    await db.update(profiles).set({
      fullName: "Jordan Rivera", location: "San Francisco, CA", country: "US",
      workAuth: { authorizedUS: true, needsSponsorship: false, status: "citizen" },
      autoApplyDailyCap: 3, autoApplyMinScore: 0.9, preferences: { lanes },
    }).where(eq(profiles.userId, userId));
    await addJob("Vercel", "Senior Frontend Engineer", "San Francisco, CA");
    await addJob("Stripe", "Senior Frontend Engineer", "San Francisco, CA", false, 2);
    await addJob("Linear", "Staff Engineer", "Remote", true, 3);
    await addJob("Figma", "Staff Engineer", "Remote - US", true, 4);
    await addJob("Notion", "Senior Frontend Engineer", "London, UK", false, 5); // wrong place
    await addJob("Ramp", "Staff Engineer", "New York, NY", false, 6); // lane is remote-only
    await addJob("Acme", "Product Designer", "San Francisco, CA", false, 7); // no lane title

    const s = await agentTick(db, userId, { runner, parallelAvailable: () => false, maxAdvance: 0 });
    expect(s.errors).toEqual([]);
    expect(s.queued).toBe(3);
    expect(s.skipped).toEqual([]);
    const byLane = new Map<string, number>();
    for (const q of s.queuedJobs) byLane.set(q.laneId, (byLane.get(q.laneId) ?? 0) + 1);
    expect([...byLane.keys()].sort()).toEqual(["frontend-sf", "staff"]);
    expect(s.queuedJobs.every((q) => !["Notion", "Ramp", "Acme"].includes(q.companyName))).toBe(true);

    const queued = await db.select().from(agentEvents).where(and(eq(agentEvents.userId, userId), eq(agentEvents.kind, "queued")));
    expect(queued.map((e) => (e.data as { laneId: string }).laneId).sort()).toEqual(s.queuedJobs.map((q) => q.laneId).sort());
    const counts = await queuedTodayByLane(db, userId, new Date(Date.now() - 3600_000));
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(3);

    // The cap is shared: a second tick the same day queues nothing more.
    const again = await agentTick(db, userId, { runner, parallelAvailable: () => false, maxAdvance: 0 });
    expect(again.queued).toBe(0);
  });

  it("disabled lanes queue nothing; per-lane minScore is honoured", async () => {
    await db.update(profiles).set({
      autoApplyDailyCap: 5, workAuth: { status: "citizen" },
      preferences: { lanes: normalizeLanes([
        { name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3, enabled: false },
        { name: "Staff", titles: ["Staff Engineer"], minScore: 0.95 },
      ]) },
    }).where(eq(profiles.userId, userId));
    await addJob("Vercel", "Senior Frontend Engineer", "Remote", true);
    // Missing required skills keep this one under the Staff lane's 95% bar.
    await addJob("Linear", "Staff Engineer", "Remote", true, 1, "\n- Kubernetes and Go\n- Rust and Kafka");
    const s = await agentTick(db, userId, { runner, parallelAvailable: () => false, maxAdvance: 0 });
    expect(s.queued).toBe(0);
    // Only the job that fits an enabled lane is scored: the other could never be queued, and scoring costs a model call.
    expect(s.scored).toBe(1);
  });

  it("scores only jobs that fit a lane, and nothing at all without a career graph", async () => {
    await db.update(profiles).set({
      autoApplyDailyCap: 5, workAuth: { status: "citizen" },
      preferences: { lanes: normalizeLanes([{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3 }]) },
    }).where(eq(profiles.userId, userId));
    await addJob("Vercel", "Senior Frontend Engineer", "Remote", true);
    await addJob("Acme", "Product Designer", "Remote", true, 1);
    await addJob("Globex", "Account Executive", "Remote", true, 2);
    const s = await agentTick(db, userId, { runner, parallelAvailable: () => false, maxAdvance: 0 });
    expect(s.errors).toEqual([]);
    expect(s.scored).toBe(1);

    // A user whose resume has not been read yet gets no scoring and no queueing.
    const other = await ensureDefaultUser(db, "nograph@example.com");
    await db.update(profiles).set({ autoApplyDailyCap: 5, preferences: { titles: ["Senior Frontend Engineer"] } }).where(eq(profiles.userId, other.id));
    const empty = await agentTick(db, other.id, { runner, parallelAvailable: () => false, maxAdvance: 0 });
    expect(empty).toMatchObject({ scored: 0, queued: 0, errors: [] });
  });

  const setLanes = (cap: number, lanes: Parameters<typeof normalizeLanes>[0]) =>
    db.update(profiles).set({ autoApplyDailyCap: cap, workAuth: { status: "citizen" }, preferences: { lanes: normalizeLanes(lanes) } }).where(eq(profiles.userId, userId));
  // no network: an empty database would otherwise make the tick poll the real starter job boards
  const tick = () => agentTick(db, userId, { runner, parallelAvailable: () => false, maxAdvance: 0, poll: async () => ({ added: 0, ids: [] }) });

  it("starts one application per company and title when a role is posted once per city", async () => {
    await setLanes(5, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3 }]);
    await addJob("Vercel", "Senior Frontend Engineer", "Remote - US", true);
    await db.insert(jobs).values({
      companyName: "Vercel", atsType: "web", externalId: "Vercel-Senior Frontend Engineer-eu", title: "Senior Frontend Engineer",
      location: "Remote - EU", remote: true, descriptionText: DESC, applyUrl: "https://example.com/Vercel-eu", postedAt: new Date(),
    });
    const s = await tick();
    expect(s.errors).toEqual([]);
    expect(s.queued).toBe(1);
    // and a later tick does not start the duplicate either
    expect((await tick()).queued).toBe(0);
  });

  it("does not queue entry-level roles for an experienced candidate, and logs why", async () => {
    await setLanes(5, [{ name: "Software", titles: ["Software Engineer"], minScore: 0.3 }]);
    await addJob("Ramp", "Software Engineering Intern, Frontend", "Remote", true);
    await addJob("Stripe", "Software Engineer, New Grad", "Remote", true, 2);
    const s = await tick();
    expect(s.queued).toBe(0);
    expect(s.skipped.map((k) => k.reasons[0])).toEqual([
      expect.stringMatching(/^Entry-level role \(intern\)/), expect.stringMatching(/^Entry-level role \(new grad\)/),
    ]);
    expect(s.note).toMatch(/checks skipped them/);
  });

  it("says why nothing was queued", async () => {
    await setLanes(0, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3 }]);
    expect((await tick()).note).toMatch(/Auto apply is off/);

    await setLanes(5, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3, enabled: false }]);
    expect((await tick()).note).toMatch(/No lane is enabled/);

    await setLanes(5, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3 }]);
    await addJob("Acme", "Account Executive", "Remote", true);
    const none = await tick();
    expect(none).toMatchObject({ queued: 0, laneJobs: 0 });
    expect(none.note).toMatch(/No open job fits your lane titles/);

    await addJob("Vercel", "Senior Frontend Engineer", "Remote", true, 2, "\n- Kubernetes, Go, Rust, Kafka, Haskell, Erlang, COBOL");
    await setLanes(5, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.99 }]);
    const low = await tick();
    expect(low.laneJobs).toBe(1);
    expect(low.note).toMatch(/1 open job fits your lanes, but none scores 99% or more/);
  });

  it("scores with rules only: no model call per job", async () => {
    let calls = 0;
    setLLM({
      provider: "openai-compatible", model: "fake", available: true, mode: "ollama",
      async json() { calls++; throw new Error("must not be called while scoring"); },
      async text() { calls++; return ""; },
    } as never);
    try {
      await addJob("Vercel", "Senior Frontend Engineer", "Remote", true);
      await addJob("Linear", "Senior Frontend Engineer", "Remote", true, 2);
      const r = await computeMatchesForUser(db, userId);
      expect(r.computed).toBe(2);
      expect(calls).toBe(0);
    } finally { setLLM(null); }
  });

  it("runs one cycle per user at a time: a second call joins the first instead of queueing everything twice", async () => {
    await setLanes(5, [{ name: "Frontend", titles: ["Senior Frontend Engineer"], minScore: 0.3 }]);
    await addJob("Vercel", "Senior Frontend Engineer", "Remote", true);
    await addJob("Linear", "Senior Frontend Engineer", "Remote", true, 2);
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(b).toBe(a); // the very same run
    expect(a.queued).toBe(2);
    const apps = await db.select().from(applications).where(eq(applications.userId, userId));
    expect(apps).toHaveLength(2);
  });
});
