import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { graphEdges, graphNodes, type JobRequirements, type ResumeContent } from "../db/schema.js";
import type { Evidence, FormField } from "../contracts.js";
import { ensureDefaultUser } from "../users.js";
import { buildBaselineResume, retrieveEvidence } from "../graph/query.js";
import { setLLM } from "../llm/index.js";
import { classifyQuestion } from "./classify.js";
import { composeAnswer, variantIndex, type ComposeInput, type ComposeJob } from "./compose.js";
import { lint, wordCount } from "./voice.js";

/** The dashboard's sample career graph (apps/web mock): Lumen Analytics, React, Next.js, p95 4.2s to 1.1s, Lumen UI. */
type N = { key: string; type: string; label: string; props?: Record<string, unknown>; startDate?: string | null; endDate?: string | null };
const NODES: N[] = [
  { key: "r1", type: "role", label: "Senior Frontend Engineer, Lumen Analytics", props: { title: "Senior Frontend Engineer" }, startDate: "2022-03", endDate: null },
  { key: "r2", type: "role", label: "Software Engineer, Brightpath", props: { title: "Software Engineer" }, startDate: "2019-06", endDate: "2022-02" },
  { key: "c1", type: "company", label: "Lumen Analytics" },
  { key: "c2", type: "company", label: "Brightpath" },
  { key: "p1", type: "project", label: "Realtime dashboard rewrite", props: { summary: "Rebuilt the core dashboard on React + streaming GraphQL" } },
  { key: "p2", type: "project", label: "Design system (Lumen UI)", props: { summary: "Shared component library, WCAG AA" } },
  { key: "s1", type: "skill", label: "React" }, { key: "s2", type: "skill", label: "TypeScript" }, { key: "s3", type: "skill", label: "Next.js" },
  { key: "s4", type: "skill", label: "GraphQL" }, { key: "s5", type: "skill", label: "Node.js" }, { key: "s6", type: "skill", label: "Web performance" },
  { key: "s7", type: "skill", label: "Accessibility" },
  { key: "m1", type: "metric", label: "p95 load 4.2s to 1.1s", props: { value: 74, unit: "%", statement: "Cut p95 dashboard load time from 4.2s to 1.1s" } },
  { key: "m2", type: "metric", label: "+38% weekly active dashboards", props: { value: 38, unit: "%", statement: "Grew weekly active dashboards by 38%" } },
  { key: "m3", type: "metric", label: "CI time -45%", props: { value: 45, unit: "%", statement: "Reduced CI time by 45% by parallelising Playwright suites" } },
  { key: "e1", type: "education", label: "BS Computer Science, UT Austin", props: { degree: "BS", field: "Computer Science" }, startDate: "2015", endDate: "2019" },
];
const EDGES: [string, string, string][] = [
  ["r1", "worked_at", "c1"], ["r2", "worked_at", "c2"], ["p1", "part_of", "r1"], ["p2", "part_of", "r1"],
  ["r1", "used", "s1"], ["r1", "used", "s2"], ["r1", "used", "s3"], ["r1", "used", "s4"],
  ["r2", "used", "s1"], ["r2", "used", "s2"], ["r2", "used", "s5"],
  ["p1", "used", "s1"], ["p1", "used", "s2"], ["p1", "used", "s4"], ["p1", "used", "s6"], ["p2", "used", "s1"], ["p2", "used", "s7"],
  ["r1", "achieved", "m1"], ["r1", "achieved", "m2"], ["p1", "achieved", "m1"], ["r2", "achieved", "m3"],
];

async function seedSampleGraph(db: Db, userId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const n of NODES) {
    const [row] = await db.insert(graphNodes).values({
      userId, type: n.type as never, label: n.label, props: n.props ?? {}, startDate: n.startDate ?? null, endDate: n.endDate ?? null, source: "resume",
    }).returning();
    ids[n.key] = row.id;
  }
  for (const [s, t, d] of EDGES) await db.insert(graphEdges).values({ userId, src: ids[s], dst: ids[d], type: t as never });
  return ids;
}

const VERCEL_JD = `About Vercel:
Vercel is the platform for frontend developers, providing the speed and reliability innovators need to create at the moment of inspiration. We are the team behind Next.js.

About the role:
As a Software Engineering Intern you will build features on the Vercel dashboard and contribute to Next.js. You will work with React, TypeScript and Next.js, and care about web performance.

What we look for:
- Experience with React and Next.js
- Familiarity with TypeScript
- Interest in web performance`;

const VERCEL_REQ: JobRequirements = {
  skills: [{ name: "React", required: true }, { name: "Next.js", required: true }, { name: "TypeScript", required: false }, { name: "Web performance", required: false }],
  seniority: "intern", roleFamily: "frontend", yearsMin: null, mustHaves: [], niceToHaves: [], disqualifiers: [], keywords: ["Next.js", "React"],
  summary: "Software engineering intern on the Vercel dashboard and Next.js",
};

const MOTIVATION_Q = "Why are you interested in interning at Vercel? What about us, our products, and/or the way we build interests you?";
const PROJECT_Q = "What's your favorite or most technically challenging project you've built?";
const textarea = (label: string, required = true): FormField => ({ label, kind: "textarea", required, selector: "#q" });

let evidence: Evidence[];
let baseline: ResumeContent;
let ids: Record<string, string>;

const job = (id: string): ComposeJob => ({ id, title: "Software Engineering Intern", companyName: "Vercel", descriptionText: VERCEL_JD, requirements: VERCEL_REQ });
const input = (label: string, jobId = "vercel-intern-1", over: Partial<ComposeInput> = {}): ComposeInput => {
  const field = textarea(label);
  return {
    kind: classifyQuestion(label, field), label, field, job: job(jobId), research: null, evidence,
    profile: { fullName: "Alex Kim", location: "San Francisco, CA" }, baseline, ...over,
  };
};

beforeAll(async () => {
  setLLM(null);
  delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_COMPAT_BASE_URL; delete process.env.LLM_PROVIDER;
  const db = await openTestDb();
  const userId = (await ensureDefaultUser(db)).id;
  ids = await seedSampleGraph(db, userId);
  evidence = await retrieveEvidence(db, userId, VERCEL_REQ);
  baseline = await buildBaselineResume(db, userId, { fullName: "Alex Kim" });
});

const METRIC = /4\.2s|1\.1s|38%|45%/;

describe("composeAnswer (offline heuristic)", () => {
  it("answers the Vercel motivation question like a person: real metric, Vercel or Next.js, lint clean, 60 to 140 words", async () => {
    const res = await composeAnswer(input(MOTIVATION_Q));
    expect(res.usedLLM).toBe(false);
    const a = res.answer!;
    expect(a).toMatch(METRIC);
    expect(a).toMatch(/Vercel|Next\.js/);
    expect(lint(a)).toEqual([]);
    expect(wordCount(a)).toBeGreaterThanOrEqual(60);
    expect(wordCount(a)).toBeLessThanOrEqual(140);
    expect(res.sources).toContain(ids.m1);
    expect(res.sources).toContain("job:description");
  });

  it("answers the project question with a problem, what was done, and the outcome", async () => {
    const res = await composeAnswer(input(PROJECT_Q));
    const a = res.answer!;
    expect(a).toMatch(METRIC);
    expect(a).toMatch(/Vercel|Next\.js/);
    expect(lint(a)).toEqual([]);
    expect(wordCount(a)).toBeGreaterThanOrEqual(60);
    expect(wordCount(a)).toBeLessThanOrEqual(140);
    expect(a).toMatch(/4\.2s/);
    expect(a).toMatch(/realtime dashboard rewrite/i);
    expect(res.sources).toContain(ids.m1);
  });

  it("different job ids give different variants", async () => {
    // Pick two ids that hash to different variants for both kinds, then check the text differs.
    const pool = Array.from({ length: 20 }, (_, i) => `vercel-job-${i}`);
    const a = pool[0];
    const b = pool.find((id) => variantIndex({ id, companyName: "", title: "" }, "motivation_company", 4) !== variantIndex({ id: a, companyName: "", title: "" }, "motivation_company", 4)
      && variantIndex({ id, companyName: "", title: "" }, "project_story", 4) !== variantIndex({ id: a, companyName: "", title: "" }, "project_story", 4))!;
    for (const q of [MOTIVATION_Q, PROJECT_Q]) {
      const x = (await composeAnswer(input(q, a))).answer!;
      const y = (await composeAnswer(input(q, b))).answer!;
      expect(x).not.toBe(y);
      expect(lint(x)).toEqual([]);
      expect(lint(y)).toEqual([]);
      expect(await composeAnswer(input(q, a)).then((r) => r.answer)).toBe(x); // deterministic per job
    }
  });

  it("every variant of every narrative kind passes lint and stays grounded", async () => {
    const qs = [MOTIVATION_Q, PROJECT_Q, "Why are you interested in this role?", "Tell us about a difficult technical challenge you faced.",
      "What are your greatest strengths?", "What is your biggest weakness?", "Why are you looking to leave your current job?",
      "Describe your ideal team environment.", "Cover letter"];
    for (const q of qs) for (let i = 0; i < 8; i++) {
      const { answer } = await composeAnswer(input(q, `job-${i}`));
      expect(answer, q).toBeTruthy();
      expect(lint(answer!), `${q}\n${answer}`).toEqual([]);
      expect(answer).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("uses company research for the hook when present", async () => {
    const research = { summary: "Vercel builds a frontend cloud for deploying web apps.", recentNews: ["Vercel launched v0 for generating UI from prompts"], citations: [{ field: "recentNews", url: "https://vercel.com/blog/v0" }] };
    const res = await composeAnswer(input(MOTIVATION_Q, "vercel-intern-1", { research }));
    expect(res.answer).toMatch(/v0|frontend cloud/);
    expect(lint(res.answer!)).toEqual([]);
    expect(res.sources.some((s) => s.startsWith("https://vercel.com"))).toBe(true);
  });

  it("short factual fields read like a person and are one or two sentences", async () => {
    const p = { fullName: "Alex Kim", location: "San Francisco, CA", salaryExpectation: { amount: 185000, currency: "USD", period: "year" as const }, earliestStartDate: "2027-06-01", noticePeriodWeeks: 2, willingToRelocate: true };
    const ask = async (label: string) => (await composeAnswer({ ...input(label), field: { label, kind: "text", required: true, selector: "" }, kind: classifyQuestion(label), profile: p })).answer;
    expect(await ask("What are your salary expectations?")).toBe("Around $185k a year, open to talking about it.");
    expect(await ask("When can you start?")).toBe("I could start on June 1, 2027. I'd need to give 2 weeks' notice first.");
    expect(await ask("Are you willing to relocate?")).toMatch(/^Yes, I'm open to relocating/);
    expect(await ask("How did you hear about us?")).toBe("Company careers page"); // where Nori found it, not an invented channel
    for (const l of ["What are your salary expectations?", "When can you start?", "Are you willing to relocate?"]) expect(lint((await ask(l))!, "short")).toEqual([]);
  });

  it("LLM path: one structured call, lint retry with findings, sources limited to real evidence", async () => {
    const prompts: string[] = [];
    const good = "Next.js is the reason. I've used it at Lumen Analytics, where I cut p95 dashboard load time from 4.2s to 1.1s on our main dashboard. That project taught me how much speed matters to people using a product every day, and Vercel is the team behind the framework I reach for first. I'd like to spend an internship close to that work, learning how the platform side handles performance at a much bigger scale than I've seen so far.";
    const answers = ["I am excited to apply. I am passionate about synergy.", good];
    setLLM({
      provider: "anthropic", model: "fake", available: true,
      async json<T>(call: { prompt: string }) { prompts.push(call.prompt); return { answer: answers.shift()!, sourcesUsed: [ids.m1, "made-up-id"] } as T; },
      async text() { return ""; },
    });
    try {
      const res = await composeAnswer(input(MOTIVATION_Q));
      expect(res.usedLLM).toBe(true);
      expect(res.answer).toBe(good);
      expect(res.sources).toEqual([ids.m1]);
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("About Vercel");
      expect(prompts[0]).toContain(`nodeId=${ids.m1}`);
      expect(prompts[1]).toMatch(/banned phrase: "I am excited to"/);

      // Still failing after the retry: fall back to the heuristic.
      answers.push("I am excited to apply.", "I am passionate about it.");
      const fallback = await composeAnswer(input(MOTIVATION_Q));
      expect(fallback.usedLLM).toBe(false);
      expect(lint(fallback.answer!)).toEqual([]);

      // Factual kinds never call the LLM.
      const before = prompts.length;
      await composeAnswer({ ...input("When can you start?"), kind: "availability" });
      expect(prompts.length).toBe(before);
    } finally {
      setLLM(null);
    }
  });

  it("returns null only for legal ids, references, missing websites and unanswerable unknowns", async () => {
    const nul = async (label: string, field: FormField = textarea(label)) => (await composeAnswer({ ...input(label), field, kind: classifyQuestion(label, field) })).answer;
    expect(await nul("Social Security Number")).toBeNull();
    expect(await nul("Please list two professional references")).toBeNull();
    expect(await nul("Portfolio URL", { label: "Portfolio URL", kind: "text", required: true, selector: "" })).toBeNull();
    expect(await nul("What is your GPA?", { label: "What is your GPA?", kind: "text", required: true, selector: "" })).toBeNull();
    expect(await nul("Anything else you'd like us to know?", textarea("Anything else you'd like us to know?", false))).toBe("");
    const site = await composeAnswer({ ...input("Portfolio URL"), kind: "portfolio_link", profile: { fullName: "A", website: "https://alex.dev" } });
    expect(site.answer).toBe("https://alex.dev");
    expect(await nul("Describe your experience with React performance work.")).toMatch(/React|Lumen/);
  });
});

describe("composeAnswer quality rules", () => {
  // A graph where the strongest-scored requirement is a soft skill and the only story has no project node.
  const ev = (o: Partial<Evidence> & Pick<Evidence, "requirement" | "nodeId" | "nodeType" | "label" | "text" | "score">): Evidence =>
    ({ roleId: "role-z", roleLabel: "Software Engineer Intern, Zillow", companyLabel: "Zillow", ...o });
  const EV: Evidence[] = [
    ev({ requirement: "Mentoring", nodeId: "role-z", nodeType: "role", label: "Software Engineer Intern, Zillow", text: "Software Engineer Intern, Zillow", score: 0.95 }),
    ev({ requirement: "Communication", nodeId: "role-z", nodeType: "role", label: "Software Engineer Intern, Zillow", text: "Software Engineer Intern, Zillow", score: 0.9 }),
    ev({ requirement: "TypeScript", nodeId: "role-z", nodeType: "role", label: "Software Engineer Intern, Zillow", text: "Software Engineer Intern, Zillow", score: 0.8 }),
    ev({ requirement: "React", nodeId: "role-z", nodeType: "role", label: "Software Engineer Intern, Zillow", text: "Software Engineer Intern, Zillow", score: 0.8 }),
    ev({ requirement: "React", nodeId: "met-z", nodeType: "metric", label: "React and TypeScript listing editor used by 3,000 agents", text: "Built React and TypeScript listing editor used by 3,000 agents", score: 1.1 }),
    ev({ requirement: "TypeScript", nodeId: "met-z", nodeType: "metric", label: "React and TypeScript listing editor used by 3,000 agents", text: "Built React and TypeScript listing editor used by 3,000 agents", score: 1.1 }),
    ev({ requirement: "Mentoring", nodeId: "met-z2", nodeType: "metric", label: "Mentored 4 interns", text: "Mentored 4 new interns through their first launch in 2 weeks", score: 0.9 }),
  ];
  const REQ: JobRequirements = { ...VERCEL_REQ, skills: [{ name: "Mentoring", required: false }, { name: "Communication", required: false }, { name: "TypeScript", required: true }, { name: "React", required: true }] };
  const BASE: ResumeContent = { name: "Alex", contact: {}, education: [], skills: [], experience: [{ title: "Software Engineer Intern", company: "Zillow", start: "Jun 2024", end: "Present", bullets: [] }] };
  const q = (label: string, id = "job-q", over: Partial<ComposeInput> = {}): ComposeInput => {
    const field = textarea(label);
    return { kind: classifyQuestion(label, field), label, field, job: { ...job(id), requirements: REQ }, research: null, evidence: EV, profile: { fullName: "Alex" }, baseline: BASE, ...over };
  };

  it("never leads with a soft skill when a technical one is matched", async () => {
    for (const label of ["Why are you interested in this role?", MOTIVATION_Q, "What are your greatest strengths?", PROJECT_Q]) {
      for (let i = 0; i < 6; i++) {
        const a = (await composeAnswer(q(label, `job-${i}`))).answer!;
        expect(a, a).not.toMatch(/Mentoring|Communication/);
        expect(a).toMatch(/TypeScript|React/);
        expect(lint(a), a).toEqual([]);
      }
    }
  });

  it("keeps proper-noun casing and names the story from the role, not a sentence fragment", async () => {
    for (let i = 0; i < 6; i++) {
      const a = (await composeAnswer(q(PROJECT_Q, `job-${i}`))).answer!;
      expect(a, a).not.toMatch(/\breact\b|\btypeScript\b/);
      expect(a, a).not.toMatch(/the React and TypeScript listing editor/i);
      expect(a, a).toMatch(/a project from my time as a Software Engineer Intern at Zillow/);
      expect(a).toMatch(/3,000 agents/);
    }
    // A project node label that starts with a skill keeps its capital.
    const withProject = await composeAnswer({ ...input(PROJECT_Q), baseline: { ...baseline, projects: [{ name: "React and TypeScript listing editor", bullets: [{ id: "x", text: "Cut p95 dashboard load time from 4.2s to 1.1s", nodeIds: [ids.m1] }] }] } });
    expect(withProject.answer).toMatch(/the React and TypeScript listing editor/);
  });

  it("challenge_story tells one story fully, no second-metric aside", async () => {
    for (let i = 0; i < 8; i++) {
      const a = (await composeAnswer(input("Tell us about a difficult technical challenge you faced.", `job-${i}`))).answer!;
      expect(a, a).not.toMatch(/On a different note|38%|45%/);
      expect(a).toMatch(/4\.2s/); // context
      expect(a).toMatch(/1\.1s/); // outcome
      expect(a).toMatch(/Software Engineering Intern|internship|Vercel/); // why it matters here
      expect(lint(a), a).toEqual([]);
    }
  });
});
