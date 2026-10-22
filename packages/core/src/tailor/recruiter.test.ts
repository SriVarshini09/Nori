import { describe, expect, it } from "vitest";
import type { JobRequirements, ResumeContent } from "../db/schema.js";
import { FLUFF_RE } from "./fluff.js";
import { recruiterReview } from "./recruiter.js";
import { tailorResumeHeuristic } from "./rewrite.js";
import { sampleBaseline, sampleEvidence, sampleRequirements } from "./sample.fixture.js";

const NOW = new Date(2026, 9, 20);
const clone = <T,>(x: T): T => structuredClone(x);
const review = (c: ResumeContent, req: JobRequirements | null = sampleRequirements, opts: { jobTitle?: string; pages?: number } = {}) =>
  recruiterReview(c, req, { jobTitle: "Senior Full-Stack Engineer", now: NOW, ...opts });
const ids = (r: ReturnType<typeof review>) => r.concerns.map((c) => c.id);
const bullet = (id: string, text: string) => ({ id, text, nodeIds: [] as string[] });
const tailored = () => tailorResumeHeuristic({ baseline: sampleBaseline, requirements: sampleRequirements, evidence: sampleEvidence, jobTitle: "Senior Full-Stack Engineer", companyName: "Omega Pay" }).content;

describe("FLUFF_RE", () => {
  it("catches the filler recruiters skim past", () => {
    for (const t of ["a robust platform", "large-scale systems", "Passionate engineer", "expertise in React", "proven track record", "results-driven", "cutting edge tools", "a rockstar developer", "strong background in data"]) {
      expect(FLUFF_RE.test(t), t).toBe(true);
    }
  });
  it("leaves plain, factual wording alone", () => {
    for (const t of ["Built a billing service for 40,000 users", "Cut latency from 900ms to 250ms", "Led a team of 4 engineers", "scalability testing", "Mentored 3 engineers"]) {
      expect(FLUFF_RE.test(t), t).toBe(false);
    }
  });
});

describe("recruiterReview", () => {
  it("is deterministic, and shows tailoring turning a listed skill into one shown in use", () => {
    const plain = review(sampleBaseline);
    expect(review(sampleBaseline)).toEqual(plain);
    // the untouched resume never names the job's skills in a bullet: three are only in the skills list, Node.js is nowhere
    // (it is in the career graph, and tailoring adds it from there)
    expect(plain.musts.filter((m) => m.required).map((m) => m.status)).toEqual(["listed", "listed", "missing", "listed"]);
    const t = review(tailored());
    const status = Object.fromEntries(t.musts.filter((m) => m.required).map((m) => [m.skill, m.status]));
    expect(status).toMatchObject({ React: "demonstrated", TypeScript: "demonstrated", "Node.js": "demonstrated" });
    expect(Object.values(status)).not.toContain("missing"); // nothing is faked, and the Node.js the graph backs is now shown
    expect(t.score).toBeGreaterThan(plain.score);
    expect(t.stats.years).toBe(10);
    expect(t.strengths.some((s) => /10 years/.test(s))).toBe(true);
  });

  it("says a required skill is missing, never invents it, and rates that as the top concern", () => {
    const req: JobRequirements = { ...sampleRequirements, skills: [{ name: "Go", required: true }, { name: "Kubernetes", required: true }, { name: "PostgreSQL", required: true }] };
    const r = review(sampleBaseline, req);
    expect(r.musts.find((m) => m.skill === "Go")!.status).toBe("missing");
    expect(r.concerns[0]).toMatchObject({ id: "missing-must-have", severity: "high" });
    expect(r.concerns[0].title).toBe("Missing 2 required skills: Go, Kubernetes");
    expect(r.concerns[0].fix).toMatch(/only if you really have/i);
    expect(r.score).toBeLessThan(review(sampleBaseline).score);
  });

  it("separates a skill shown in use from one that is only in the skills list", () => {
    const c = clone(sampleBaseline);
    c.experience.forEach((r) => r.bullets.forEach((b) => { b.text = b.text.replace(/TypeScript/g, "types"); }));
    const r = review(c);
    expect(r.musts.find((m) => m.skill === "TypeScript")!.status).toBe("listed"); // in the skills list, in no bullet
    expect(ids(r)).toContain("listed-only");
  });

  it("flags too few years, too senior a title for the job, and an overqualified resume for an entry-level post", () => {
    expect(ids(review(sampleBaseline, { ...sampleRequirements, yearsMin: 15 }))).toContain("years");
    const junior = clone(sampleBaseline);
    junior.experience[0].title = "Junior Developer";
    expect(ids(review(junior))).toContain("seniority");
    const entry = review(sampleBaseline, { ...sampleRequirements, seniority: "junior", yearsMin: 1 }, { jobTitle: "Software Engineer I" });
    expect(ids(entry)).toContain("overqualified");
    expect(entry.concerns.find((c) => c.id === "overqualified")!.fix).toMatch(/leave out years/i);
  });

  it("wants a number in the bullets, strong openers, and short bullets", () => {
    const c = clone(sampleBaseline);
    c.experience.forEach((r) => r.bullets.forEach((b, i) => { b.text = i % 2 ? "The team worked on various internal tools and also did many other things as needed across the organisation together with partners" : "Responsible for the dashboard"; }));
    const r = review(c);
    expect(ids(r)).toEqual(expect.arrayContaining(["impact", "openers"]));
    expect(r.stats.quantifiedPct).toBe(0);
  });

  it("marks filler in the summary, a summary with no proof, and rewards a short summary with a real result", () => {
    const withSummary = (summary: string) => review({ ...clone(sampleBaseline), summary });
    expect(ids(withSummary("Passionate engineer with expertise in React and a proven track record"))).toContain("fluff");
    expect(ids(withSummary("Engineer who builds web products for customers."))).toContain("summary-generic");
    const good = withSummary("Senior Software Engineer with 10 years of experience in React and Node.js. Cut p95 API latency from 900ms to 250ms.");
    expect(ids(good)).not.toEqual(expect.arrayContaining(["fluff", "summary-generic"]));
    expect(good.strengths).toContain("The summary is short and carries a real result");
    expect(ids(review({ ...clone(sampleBaseline), summary: "" }))).toContain("no-summary");
  });

  it("notices when the top of the latest role does not lead with what the job asks for", () => {
    const c = tailored();
    const first = c.experience[0].bullets;
    expect(ids(review(c))).not.toContain("lead");
    // put the two bullets that mention none of the job's skills at the top
    const off = first.filter((b) => !/React|TypeScript|Node\.js|PostgreSQL/.test(b.text));
    const on = first.filter((b) => /React|TypeScript|Node\.js|PostgreSQL/.test(b.text));
    expect(off.length).toBeGreaterThanOrEqual(2);
    c.experience[0].bullets = [...off, ...on];
    expect(ids(review(c))).toContain("lead");
  });

  it("notices a resume that is mostly about other things", () => {
    const c = clone(sampleBaseline);
    const r = review(c, { ...sampleRequirements, skills: [{ name: "COBOL", required: false }, { name: "PostgreSQL", required: false }] });
    expect(ids(r)).toContain("focus");
  });

  it("looks for the credibility problems a screener checks: gaps, long skill lists, repetition, contact, length", () => {
    const gap = clone(sampleBaseline);
    gap.experience[1].end = "2020-01"; // Beta Health ends; Acme starts 2021-04: 15 months
    expect(ids(review(gap))).toContain("gap");
    const stuffed = clone(sampleBaseline);
    stuffed.skills = [{ group: "Skills", items: Array.from({ length: 24 }, (_, i) => `Tool${i}`) }];
    expect(ids(review(stuffed))).toContain("skills-long");
    const repeated = clone(sampleBaseline);
    repeated.experience[0].bullets = Array.from({ length: 6 }, (_, i) => bullet(`x${i}`, `Built React feature number ${i + 1} used by ${i + 10} customers`));
    expect(ids(review(repeated))).toContain("stuffing");
    const noContact = clone(sampleBaseline);
    noContact.contact = { location: "Austin" };
    expect(ids(review(noContact))).toContain("contact");
    expect(ids(review(sampleBaseline, sampleRequirements, { pages: 3 }))).toContain("length");
    expect(review(sampleBaseline, sampleRequirements, { pages: 1 }).strengths).toContain("Fits on one page");
  });

  it("orders concerns by severity, keeps the score in range, and handles a job with no requirements", () => {
    const req: JobRequirements = { ...sampleRequirements, skills: [{ name: "Go", required: true }], yearsMin: 20 };
    const r = review(sampleBaseline, req);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < r.concerns.length; i++) expect(order[r.concerns[i].severity]).toBeGreaterThanOrEqual(order[r.concerns[i - 1].severity]);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.verdict).toBe(r.score >= 80 ? "strong" : r.score >= 60 ? "good" : "needs_work");
    const none = review(sampleBaseline, null);
    expect(none.musts).toEqual([]);
    expect(none.score).toBeGreaterThan(0);
  });
});
