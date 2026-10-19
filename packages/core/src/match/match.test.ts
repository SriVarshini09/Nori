import { describe, expect, it } from "vitest";
import { scoreMatch, computeMatch, disqualifierConflicts } from "./score.js";
import type { Evidence } from "../contracts.js";
import type { JobRequirements } from "../db/schema.js";
import { openTestDb } from "../db/client.js";
import { jobs, users, profiles, matches } from "../db/schema.js";
import { eq } from "drizzle-orm";

const ev = (p: Partial<Evidence> & Pick<Evidence, "nodeId" | "label" | "text">): Evidence => ({
  requirement: p.label, nodeType: "metric", score: 0.8, ...p,
});

const evidence: Evidence[] = [
  ev({ nodeId: "s-react", nodeType: "skill", label: "React", text: "React", roleId: "r1", roleLabel: "Senior Frontend Engineer" }),
  ev({ nodeId: "m1", label: "Checkout rebuild", text: "Rebuilt checkout in React and TypeScript, cutting load time 40% for 2M monthly users", roleId: "r1", roleLabel: "Senior Frontend Engineer", companyLabel: "Acme" }),
  ev({ nodeId: "m2", label: "Design system", text: "Led a TypeScript design system adopted by 6 product teams", roleId: "r2", roleLabel: "Frontend Engineer", companyLabel: "Beta" }),
  ev({ nodeId: "m3", label: "GraphQL gateway", text: "Built a GraphQL gateway in Node.js serving 30 microservices", roleId: "r2", roleLabel: "Frontend Engineer", companyLabel: "Beta" }),
  ev({ nodeId: "m4", label: "Mentoring", text: "Mentored 4 junior engineers through code review and pairing", roleId: "r1", roleLabel: "Senior Frontend Engineer" }),
];

const strongJob: JobRequirements = {
  skills: [
    { name: "React", required: true }, { name: "TypeScript", required: true }, { name: "Node.js", required: true },
    { name: "GraphQL", required: false },
  ],
  seniority: "senior", roleFamily: "frontend", yearsMin: 5,
  mustHaves: ["Experience mentoring junior engineers"],
  niceToHaves: ["Design system experience"],
  disqualifiers: [],
  keywords: ["React", "TypeScript", "checkout", "design system"],
  summary: "Senior frontend engineer",
};

const weakJob: JobRequirements = {
  skills: [
    { name: "Kubernetes", required: true }, { name: "Go", required: true }, { name: "Terraform", required: true },
    { name: "React", required: false },
  ],
  seniority: "senior", roleFamily: "platform", yearsMin: 5,
  mustHaves: ["Operated production Kubernetes clusters at scale"],
  niceToHaves: [],
  disqualifiers: [],
  keywords: ["Kubernetes", "Terraform", "SRE"],
  summary: "Platform engineer",
};

describe("scoreMatch", () => {
  it("ranks a well-covered job above a poorly covered one", () => {
    const strong = scoreMatch(strongJob, evidence, {});
    const weak = scoreMatch(weakJob, evidence, {});
    expect(strong.score).toBeGreaterThan(0.85);
    expect(weak.score).toBeLessThan(0.3);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("lists missing required skills and must-haves", () => {
    const weak = scoreMatch(weakJob, evidence, {});
    const missingReq = weak.missing.filter((m) => m.required).map((m) => m.requirement);
    expect(missingReq).toEqual(expect.arrayContaining(["Kubernetes", "Go", "Terraform", "Operated production Kubernetes clusters at scale"]));
    expect(weak.matched.map((m) => m.requirement)).toContain("React");
    expect(weak.matched.find((m) => m.requirement === "React")?.required).toBe(false);
    expect(weak.reasons.some((r) => r.startsWith("Missing Kubernetes"))).toBe(true);
  });

  it("matches skills to evidence nodes and explains in 3 to 5 sentences", () => {
    const strong = scoreMatch(strongJob, evidence, {});
    expect(strong.missing.filter((m) => m.required)).toEqual([]);
    expect(strong.matched.find((m) => m.requirement === "React")?.nodeId).toBe("s-react");
    expect(strong.matched.find((m) => m.requirement === "Node.js")?.nodeId).toBe("m3");
    expect(strong.matched.some((m) => m.requirement === "Experience mentoring junior engineers" && m.nodeId === "m4")).toBe(true);
    expect(strong.reasons.length).toBeGreaterThanOrEqual(3);
    expect(strong.reasons.length).toBeLessThanOrEqual(5);
    expect(strong.reasons[0]).toMatch(/^Strong on React, TypeScript and Node\.js via 2 roles\.$/);
  });

  it("penalizes disqualifiers that conflict with the profile", () => {
    const job = { ...strongJob, disqualifiers: ["We do not offer visa sponsorship", "Must be located in New York"] };
    const ok = scoreMatch(job, evidence, { workAuth: { needsSponsorship: false }, location: "Brooklyn, New York" });
    const bad = scoreMatch(job, evidence, { workAuth: { needsSponsorship: true }, location: "Austin, TX" });
    expect(ok.score - bad.score).toBeCloseTo(0.3, 5);
    expect(bad.reasons.some((r) => /sponsorship/i.test(r))).toBe(true);
    expect(disqualifierConflicts(["Must be located in the US"], { location: "Seattle, WA" })).toEqual([]);
    expect(disqualifierConflicts(["Must be located in the US"], { location: "Toronto, Canada" })).toHaveLength(1);
  });

  it("is 0 with no evidence and clamps at 0", () => {
    const r = scoreMatch({ ...weakJob, disqualifiers: ["No sponsorship"] }, [], { workAuth: { needsSponsorship: true } });
    expect(r.score).toBe(0);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("computeMatch", () => {
  it("loads requirements, uses the injected retriever and upserts the row", async () => {
    const db = await openTestDb();
    const [u] = await db.insert(users).values({ email: "m@test.dev" }).returning();
    await db.insert(profiles).values({ userId: u.id, location: "San Francisco, CA" });
    const [j] = await db.insert(jobs).values({
      companyName: "Acme", atsType: "manual", externalId: "x1", title: "Senior Frontend Engineer",
      descriptionText: "...", applyUrl: "https://example.com", requirements: strongJob,
    }).returning();
    let calls = 0;
    const retrieve = async () => { calls++; return evidence; };
    const r1 = await computeMatch(db, u.id, j.id, retrieve);
    const r2 = await computeMatch(db, u.id, j.id, retrieve);
    expect(calls).toBe(2);
    expect(r2.score).toBe(r1.score);
    const rows = await db.select().from(matches).where(eq(matches.jobId, j.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeCloseTo(r1.score, 5);
    expect(rows[0].explanation.reasons).toEqual(r1.reasons);
  });
});
