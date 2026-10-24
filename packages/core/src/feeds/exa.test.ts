import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { discoverJobs, searchAvailable } from "./discover.js";
import { exaAvailable, exaSearch } from "./exa.js";
import { SOCIAL_SOURCES, applyLinkIn, heuristicPosting, sourceFor } from "./social.js";

let db: Db;
let server: Server;
let requests: { body: any; key: string | undefined }[] = [];

/** A stand-in for api.exa.ai: answers by the domains asked for. */
const RESULTS: Record<string, any[]> = {
  "x.com": [
    { url: "https://x.com/acmeai/status/1", title: "Acme AI on X", author: "@acmeai", publishedDate: "2026-10-20",
      text: "We're hiring a Senior Backend Engineer to scale our inference platform in San Francisco (remote OK). Python, Kubernetes, Postgres. Apply: https://jobs.acme.ai/senior-backend-engineer #hiring" },
    { url: "https://x.com/someone/status/2", title: "someone on X", author: "@someone", publishedDate: "2026-10-21",
      text: "After four years at BigCo I'm looking for my next role as a backend engineer. Open to work, remote preferred. DMs open!" },
  ],
  "news.ycombinator.com": [
    { url: "https://news.ycombinator.com/item?id=5551", title: "Ask HN: Who is hiring? (October 2026)", author: null, publishedDate: "2026-10-02",
      text: "Northwind Labs | Senior Software Engineer | Seattle, WA | REMOTE | Full-time. We build billing infrastructure in TypeScript and Postgres. Email jobs@northwind.example to apply." },
  ],
  "linkedin.com": [
    { url: "https://www.linkedin.com/jobs/view/12345", title: "Brightside Analytics hiring Staff Data Engineer in Austin, TX | LinkedIn", author: null, publishedDate: "2026-10-18",
      text: "Brightside Analytics is seeking a Staff Data Engineer to lead our pipeline platform. Airflow, Python, dbt. Hybrid in Austin, TX. Apply on LinkedIn." },
  ],
  "wellfound.com": [],
  "ycombinator.com": [],
  "boards.greenhouse.io": [],
};

beforeAll(async () => {
  db = await openTestDb();
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      requests.push({ body: parsed, key: req.headers["x-api-key"] as string | undefined });
      if (req.headers["x-api-key"] !== "exa-test-key") { res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad key" })); return; }
      const domains: string[] = parsed.includeDomains ?? [];
      const results = domains.flatMap((d) => RESULTS[d] ?? []);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  process.env.EXA_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);
afterAll(() => { delete process.env.EXA_BASE_URL; return new Promise<void>((r) => server.close(() => r())); });

const SAVED = ["EXA_API_KEY", "PARALLEL_API_KEY", "HOSTED_LLM_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_COMPAT_BASE_URL", "LLM_PROVIDER"];
let saved: Record<string, string | undefined>;
beforeEach(async () => {
  saved = Object.fromEntries(SAVED.map((k) => [k, process.env[k]]));
  for (const k of SAVED) delete process.env[k];
  requests = [];
  await db.delete(jobs);
});
afterEach(() => { for (const k of SAVED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("exa client", () => {
  it("is off without a key and says so plainly", async () => {
    expect(exaAvailable()).toBe(false);
    expect(searchAvailable()).toBe(false);
    await expect(exaSearch({ query: "x" })).rejects.toThrow(/EXA_API_KEY/);
    await expect(discoverJobs(db, { objective: "backend engineer" })).rejects.toThrow(/No web search is configured/);
  });

  it("sends the key, the domains, the category and the date, and never echoes the key on failure", async () => {
    process.env.EXA_API_KEY = "exa-test-key";
    const r = await exaSearch({ query: "backend engineer hiring", includeDomains: ["x.com"], category: "tweet", startPublishedDate: "2026-09-01", numResults: 7 });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ url: "https://x.com/acmeai/status/1", author: "@acmeai" });
    expect(requests.at(-1)!.body).toMatchObject({ query: "backend engineer hiring", includeDomains: ["x.com"], category: "tweet", startPublishedDate: "2026-09-01", numResults: 7, type: "auto" });
    expect(requests.at(-1)!.key).toBe("exa-test-key");
    process.env.EXA_API_KEY = "wrong-key-secret";
    await expect(exaSearch({ query: "x" })).rejects.toThrow(/Exa search failed: 401/);
    await expect(exaSearch({ query: "x" })).rejects.not.toThrow(/wrong-key-secret/);
  });
});

describe("reading social hits as postings (rules only, no model)", () => {
  it("knows the sources by host", () => {
    expect(sourceFor("https://twitter.com/a/status/1")?.id).toBe("x");
    expect(sourceFor("https://www.linkedin.com/jobs/view/1")?.id).toBe("linkedin");
    expect(sourceFor("https://example.com/jobs")).toBeNull();
    expect(SOCIAL_SOURCES.map((s) => s.id)).toEqual(["x", "hn", "wellfound", "yc", "linkedin"]);
  });

  it("finds the apply link in a post and ignores links back to the social site", () => {
    expect(applyLinkIn("Apply here: https://jobs.acme.ai/role. More at https://x.com/acme", "https://x.com/acme/status/1")).toBe("https://jobs.acme.ai/role");
    expect(applyLinkIn("no links here", "https://x.com/a/status/1")).toBeNull();
  });

  it("reads an X post, an HN comment and a LinkedIn page, and rejects a job seeker's post", () => {
    const x = heuristicPosting(RESULTS["x.com"][0], SOCIAL_SOURCES[0]);
    expect(x).toMatchObject({ isPosting: true, company: "acmeai", remote: true });
    expect(x.title).toMatch(/Senior Backend Engineer/);
    const seeker = heuristicPosting(RESULTS["x.com"][1], SOCIAL_SOURCES[0]);
    expect(seeker.isPosting).toBe(false);
    const hn = heuristicPosting(RESULTS["news.ycombinator.com"][0], SOCIAL_SOURCES[1]);
    expect(hn).toMatchObject({ isPosting: true, company: "Northwind Labs", title: "Senior Software Engineer", remote: true });
    const li = heuristicPosting(RESULTS["linkedin.com"][0], SOCIAL_SOURCES[4]);
    expect(li).toMatchObject({ isPosting: true, company: "Brightside Analytics", title: "Staff Data Engineer", location: "Austin, TX" });
  });
});

describe("discovery through Exa", () => {
  it("stores postings from X, Hacker News and LinkedIn with their apply links, skips the job seeker, and dedupes on rerun", async () => {
    process.env.EXA_API_KEY = "exa-test-key";
    const r = await discoverJobs(db, { objective: "senior backend engineer", titles: ["Senior Backend Engineer"], remote: true, maxResults: 6 });
    expect(r.added).toBe(3);
    const rows = await db.select().from(jobs).where(eq(jobs.atsType, "web"));
    const byCompany = Object.fromEntries(rows.map((j) => [j.companyName, j]));
    expect(byCompany["acmeai"]).toMatchObject({ applyUrl: "https://jobs.acme.ai/senior-backend-engineer", discoveredVia: "exa_social", remote: true });
    expect(byCompany["Northwind Labs"]).toMatchObject({ title: "Senior Software Engineer", applyUrl: "https://news.ycombinator.com/item?id=5551" });
    expect(byCompany["Brightside Analytics"]).toMatchObject({ title: "Staff Data Engineer", location: "Austin, TX" });
    expect(byCompany["acmeai"].descriptionText).toContain("Found on X");
    expect(rows.some((j) => /looking for my next role/.test(j.descriptionText))).toBe(false);
    // the ATS sweep and every social source were asked, with a freshness date
    const asked = requests.map((q) => (q.body.includeDomains ?? [])[0]);
    expect(asked).toContain("boards.greenhouse.io");
    for (const s of SOCIAL_SOURCES) expect(asked).toContain(s.domains[0]);
    expect(requests.every((q) => typeof q.body.startPublishedDate === "string")).toBe(true);
    const again = await discoverJobs(db, { objective: "senior backend engineer", maxResults: 6 });
    expect(again.added).toBe(0);
    expect(await db.select().from(jobs)).toHaveLength(3);
  });
});
