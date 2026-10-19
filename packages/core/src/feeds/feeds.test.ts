import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import { setLLM } from "../llm/index.js";
import type { NormalizedJob } from "../contracts.js";
import { ashby } from "./ashby.js";
import { addJobFromUrl, discoverJobs } from "./discover.js";
import { greenhouse } from "./greenhouse.js";
import { htmlToText } from "./html.js";
import { FEEDS } from "./index.js";
import { lever } from "./lever.js";
import { pollTenant, upsertJobs } from "./normalize.js";
import { extractRequirements, ensureRequirements } from "./requirements.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { researchCompany } from "../research/company.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GH_JOBS = {
  jobs: [
    {
      id: 4001, title: "Senior Frontend Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/4001",
      updated_at: "2025-03-01T10:00:00-05:00", location: { name: "Remote - US" },
      content: "&lt;p&gt;Build UI with &lt;strong&gt;React&lt;/strong&gt; &amp;amp; TypeScript.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;4+ years of experience&lt;/li&gt;&lt;/ul&gt;",
    },
    { id: 4002, title: "Data Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/4002", location: { name: "New York, NY" }, content: "&lt;p&gt;Pipelines.&lt;/p&gt;" },
  ],
};
const LEVER_JOBS = [
  {
    id: "11111111-aaaa-bbbb-cccc-222222222222", text: "Backend Engineer", hostedUrl: "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222",
    applyUrl: "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222/apply",
    descriptionPlain: "Build services in Go.", lists: [{ text: "Requirements", content: "<li>Go</li><li>Postgres</li>" }],
    additionalPlain: "We are an equal opportunity employer.", categories: { location: "San Francisco, CA" },
    createdAt: 1700000000000, workplaceType: "hybrid",
  },
  { id: "33333333-aaaa-bbbb-cccc-444444444444", text: "Designer", hostedUrl: "https://jobs.lever.co/globex/3333", descriptionPlain: "Design.", categories: { location: "Anywhere" }, createdAt: 1700000001000, workplaceType: "remote" },
];

let fetchMock: ReturnType<typeof vi.fn>;
function route(handlers: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, h] of Object.entries(handlers)) if (url.startsWith(prefix)) return h(url, init);
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  setLLM({ provider: "none", model: "none", available: false, json: async () => { throw new Error("none"); }, text: async () => { throw new Error("none"); } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setLLM(null);
});

describe("feed parsing", () => {
  it("parses greenhouse", async () => {
    route({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": () => json(GH_JOBS) });
    const out = await greenhouse.fetchJobs("acme");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      atsType: "greenhouse", externalId: "4001", companyToken: "acme", companyName: "Acme", title: "Senior Frontend Engineer",
      location: "Remote - US", remote: true, applyUrl: "https://boards.greenhouse.io/acme/jobs/4001",
    });
    expect(out[0].descriptionText).toContain("Build UI with React & TypeScript.");
    expect(out[0].descriptionText).toContain("- 4+ years of experience");
    expect(out[0].postedAt?.getUTCFullYear()).toBe(2025);
    expect(out[1].remote).toBe(false);
  });

  it("parses lever", async () => {
    route({ "https://api.lever.co/v0/postings/globex?mode=json": () => json(LEVER_JOBS) });
    const out = await lever.fetchJobs("globex");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ atsType: "lever", title: "Backend Engineer", location: "San Francisco, CA", remote: false, applyUrl: LEVER_JOBS[0].hostedUrl });
    expect(out[0].descriptionText).toContain("Build services in Go.");
    expect(out[0].descriptionText).toContain("- Postgres");
    expect(out[0].postedAt?.getTime()).toBe(1700000000000);
    expect(out[1].remote).toBe(true);
  });

  it("parses ashby and smartrecruiters", async () => {
    route({
      "https://api.ashbyhq.com/posting-api/job-board/initech": () => json({ jobs: [
        { id: "a1", title: "ML Engineer", location: "Remote", isRemote: true, descriptionPlain: "Train models", jobUrl: "https://jobs.ashbyhq.com/initech/a1", applyUrl: "https://jobs.ashbyhq.com/initech/a1/application", publishedAt: "2025-01-02" },
        { id: "a2", title: "Hidden", isListed: false, descriptionPlain: "x", jobUrl: "u" },
      ] }),
      "https://api.smartrecruiters.com/v1/companies/Hooli/postings?": () => json({ totalFound: 1, content: [{ id: "743999", name: "SRE", company: { name: "Hooli" }, location: { city: "Austin", country: "us", remote: false } }] }),
      "https://api.smartrecruiters.com/v1/companies/Hooli/postings/743999": () => json({ id: "743999", name: "SRE", company: { name: "Hooli" }, location: { city: "Austin", country: "us" }, postingUrl: "https://jobs.smartrecruiters.com/Hooli/743999-sre", jobAd: { sections: { jobDescription: { title: "Job Description", text: "<p>Keep it up</p>" }, qualifications: { title: "Qualifications", text: "<ul><li>Kubernetes</li></ul>" } } } }),
    });
    const a = await ashby.fetchJobs("initech");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ externalId: "a1", remote: true, applyUrl: "https://jobs.ashbyhq.com/initech/a1/application" });
    const s = await smartrecruiters.fetchJobs("Hooli");
    expect(s[0]).toMatchObject({ externalId: "743999", companyName: "Hooli", location: "Austin, US" });
    expect(s[0].descriptionText).toContain("- Kubernetes");
  });

  it("returns [] on 404 and throws on other errors", async () => {
    route({ "https://boards-api.greenhouse.io/v1/boards/missing": () => new Response("nope", { status: 404 }), "https://api.lever.co": () => new Response("boom", { status: 500 }) });
    expect(await greenhouse.fetchJobs("missing")).toEqual([]);
    await expect(lever.fetchJobs("x")).rejects.toThrow(/500/);
  });

  it("parseUrl recognizes all five URL shapes", () => {
    expect(greenhouse.parseUrl("https://boards.greenhouse.io/acme/jobs/4001")).toEqual({ token: "acme", externalId: "4001" });
    expect(greenhouse.parseUrl("https://job-boards.greenhouse.io/acme/jobs/4001?gh_src=x")).toEqual({ token: "acme", externalId: "4001" });
    expect(lever.parseUrl("https://jobs.lever.co/globex/11111111-aaaa")).toEqual({ token: "globex", externalId: "11111111-aaaa" });
    expect(ashby.parseUrl("https://jobs.ashbyhq.com/initech/a1")).toEqual({ token: "initech", externalId: "a1" });
    expect(smartrecruiters.parseUrl("https://jobs.smartrecruiters.com/Hooli/743999-site-reliability-engineer")).toEqual({ token: "Hooli", externalId: "743999" });
    expect(greenhouse.parseUrl("https://jobs.lever.co/globex/1")).toBeNull();
    expect(lever.parseUrl("https://example.com/globex/1")).toBeNull();
    expect(Object.keys(FEEDS).sort()).toEqual(["ashby", "greenhouse", "lever", "smartrecruiters"]);
  });
});

describe("htmlToText", () => {
  it("keeps block breaks, bullets and decodes entities", () => {
    const t = htmlToText("<h2>About</h2><p>Hello&nbsp;world &amp; &#169; &#x41;</p><ul><li>One</li><li>Two<br>three</li></ul><script>x()</script>");
    expect(t).toContain("Hello world & © A");
    expect(t).toMatch(/- One\n+- Two\nthree/);
    expect(t).not.toContain("x()");
    expect(t).not.toContain("<");
  });
});

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  atsType: "greenhouse", externalId: "1", companyName: "Acme", companyToken: "acme", title: "Engineer", remote: false,
  descriptionText: "Do things", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", discoveredVia: "feed", ...over,
});

describe("upsertJobs / pollTenant", () => {
  it("adds then updates, creating a company row", async () => {
    const db = await openTestDb();
    const first = await upsertJobs(db, [job(), job({ externalId: "2", title: "Other" })]);
    expect(first).toMatchObject({ added: 2, updated: 0 });
    expect(first.ids).toHaveLength(2);
    const [co] = await db.select().from(companies);
    expect(co).toMatchObject({ name: "Acme", atsType: "greenhouse", atsToken: "acme" });

    const [before] = await db.select().from(jobs).where(eq(jobs.externalId, "1"));
    await new Promise((r) => setTimeout(r, 5));
    const second = await upsertJobs(db, [job({ title: "Staff Engineer" })]);
    expect(second).toMatchObject({ added: 0, updated: 1 });
    expect(second.ids[0]).toBe(first.ids[0]);
    const [after] = await db.select().from(jobs).where(eq(jobs.externalId, "1"));
    expect(after.title).toBe("Staff Engineer");
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
    expect(after.companyId).toBe(co.id);
    expect((await db.select().from(jobs))).toHaveLength(2);
  });

  it("pollTenant marks unseen jobs closed", async () => {
    const db = await openTestDb();
    route({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs": () => json(GH_JOBS) });
    expect(await pollTenant(db, "greenhouse", "acme")).toMatchObject({ added: 2, closed: 0 });
    route({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs": () => json({ jobs: [GH_JOBS.jobs[0]] }) });
    expect(await pollTenant(db, "greenhouse", "acme")).toMatchObject({ added: 0, updated: 1, closed: 1 });
    const rows = await db.select().from(jobs);
    expect(rows.find((r) => r.externalId === "4002")?.closedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.externalId === "4001")?.closedAt).toBeNull();
  });
});

const SAMPLE_JD = `About Acme
We build tools for designers.

What you'll do
- Own the web app front to back.

Requirements
- 4+ years of experience building production web apps
- Strong React and TypeScript skills
- Experience with GraphQL APIs

Nice to have
- Experience with Rust
- Familiarity with Kubernetes

Candidates must be located in the United States. We are unable to provide visa sponsorship.

Benefits
- Health insurance`;

describe("extractRequirements (heuristic)", () => {
  it("extracts skills, seniority, years and sections", async () => {
    const { requirements: r, usedLLM } = await extractRequirements({ title: "Senior Frontend Engineer", descriptionText: SAMPLE_JD });
    expect(usedLLM).toBe(false);
    expect(r.seniority).toBe("senior");
    expect(r.yearsMin).toBe(4);
    expect(r.roleFamily).toBe("frontend");
    expect(r.skills.find((s) => s.name === "React")?.required).toBe(true);
    expect(r.skills.find((s) => s.name === "TypeScript")?.required).toBe(true);
    expect(r.skills.find((s) => s.name === "Rust")?.required).toBe(false);
    expect(r.mustHaves).toHaveLength(3);
    expect(r.niceToHaves).toHaveLength(2);
    expect(r.disqualifiers.join(" ")).toMatch(/must be located/i);
    expect(r.disqualifiers.join(" ")).toMatch(/sponsor/i);
    expect(r.keywords).toContain("React");
    expect(r.summary.length).toBeLessThanOrEqual(300);
  });

  it("ensureRequirements stores once", async () => {
    const db = await openTestDb();
    const { ids } = await upsertJobs(db, [job({ title: "Senior Frontend Engineer", descriptionText: SAMPLE_JD })]);
    const r = await ensureRequirements(db, ids[0]);
    expect(r?.yearsMin).toBe(4);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, ids[0]));
    expect(row.requirements?.seniority).toBe("senior");
    expect(await ensureRequirements(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("discoverJobs", () => {
  it("searches via Parallel, resolves through the ATS feed, and falls back to extract", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    let searchBody: any;
    route({
      "https://api.parallel.ai/v1/search": async (_u, init) => {
        searchBody = JSON.parse(String(init?.body));
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
        return json({ results: [
          { url: "https://boards.greenhouse.io/acme/jobs/4001", title: "Senior Frontend Engineer", excerpts: ["x"] },
          { url: "https://job-boards.greenhouse.io/acme/jobs/4002#apply", title: "Data Engineer", excerpts: [] },
          { url: "https://jobs.lever.co/gone/deadbeef", title: "Platform Engineer at Gone", excerpts: ["short excerpt"] },
          { url: "https://boards.greenhouse.io/acme", title: "Acme board", excerpts: [] },
        ] });
      },
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": () => json(GH_JOBS),
      "https://api.lever.co/v0/postings/gone": () => new Response("nope", { status: 404 }),
      "https://api.parallel.ai/v1/extract": () => json({ results: [{ url: "https://jobs.lever.co/gone/deadbeef", full_content: "# Platform Engineer\n\nRemote role working on Kubernetes." }] }),
    });
    const db = await openTestDb();
    const res = await discoverJobs(db, { objective: "senior frontend roles remote", titles: ["Frontend Engineer"], remote: true });

    expect(searchBody.search_queries.length).toBeGreaterThanOrEqual(2);
    expect(searchBody.search_queries.length).toBeLessThanOrEqual(3);
    expect(searchBody.advanced_settings.source_policy.include_domains).toContain("jobs.ashbyhq.com");
    expect(res.added).toBe(3);
    expect(res.jobs.map((j) => j.externalId).slice(0, 2)).toEqual(["4001", "4002"]);
    expect(res.jobs[0]).toMatchObject({ atsType: "greenhouse", discoveredVia: "parallel_search" });
    const web = res.jobs[2];
    expect(web.atsType).toBe("web");
    expect(web.externalId).toMatch(/^[0-9a-f]{40}$/);
    expect(web.title).toBe("Platform Engineer");
    expect(web.descriptionText).toContain("Kubernetes");
    // greenhouse tenant feed fetched once for two results
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith("https://boards-api.greenhouse.io")).length).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(3);
  });

  it("addJobFromUrl uses the feed for a known ATS URL and rejects a board root", async () => {
    route({ "https://api.lever.co/v0/postings/globex": () => json(LEVER_JOBS) });
    const db = await openTestDb();
    const { job: row, added } = await addJobFromUrl(db, "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222");
    expect(added).toBe(true);
    expect(row).toMatchObject({ title: "Backend Engineer", atsType: "lever", discoveredVia: "pasted" });
    expect((await addJobFromUrl(db, "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222")).added).toBe(false);
    await expect(addJobFromUrl(db, "https://jobs.lever.co/globex")).rejects.toThrow(/board/);
  });

  it("throws a clear error without PARALLEL_API_KEY", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "");
    const db = await openTestDb();
    await expect(discoverJobs(db, { objective: "x" })).rejects.toThrow(/PARALLEL_API_KEY/);
  });
});

describe("researchCompany", () => {
  it("returns a stub without a key", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "");
    const db = await openTestDb();
    const r = await researchCompany(db, "Acme");
    expect(r).toEqual({ summary: "Research unavailable (no PARALLEL_API_KEY)", citations: [] });
  });

  it("runs a task, maps citations, and stores on the company row", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    let attempts = 0;
    route({
      "https://api.parallel.ai/v1/tasks/runs/run_1/result": () => (++attempts === 1 ? new Response("timeout", { status: 408 }) : json({
        output: {
          content: { summary: "Acme makes anvils.", stage: "Series B", funding: "$40M", headcount: "120", recentNews: ["Raised Series B"], interviewProcess: "4 rounds", sponsorshipSignals: "Files H-1B" },
          basis: [{ field: "stage", citations: [{ url: "https://news.example/acme", title: "Acme raises" }], reasoning: "r", confidence: "high" }],
        },
      })),
      "https://api.parallel.ai/v1/tasks/runs": () => json({ run_id: "run_1" }),
    });
    const db = await openTestDb();
    await upsertJobs(db, [job()]);
    const r = await researchCompany(db, "ACME", "acme.com");
    expect(attempts).toBe(2);
    expect(r).toMatchObject({ summary: "Acme makes anvils.", stage: "Series B", recentNews: ["Raised Series B"] });
    expect(r.citations).toEqual([{ field: "stage", url: "https://news.example/acme", title: "Acme raises" }]);
    const [co] = await db.select().from(companies);
    expect(co.research?.stage).toBe("Series B");
    expect(co.researchedAt).toBeInstanceOf(Date);
  });
});
