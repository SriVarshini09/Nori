import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, type CompanyResearch } from "../db/schema.js";
import { parallelAvailable, parallelTaskRun } from "../feeds/parallel.js";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two or three sentences on what the company does and who it sells to." },
    stage: { type: "string", description: "Funding stage or company stage (seed, Series B, public, bootstrapped...)." },
    funding: { type: "string", description: "Total funding raised and most recent round with date, if known." },
    headcount: { type: "string", description: "Approximate employee count." },
    recentNews: { type: "array", items: { type: "string" }, description: "Up to 5 notable news items from the last 12 months, one sentence each." },
    interviewProcess: { type: "string", description: "Typical interview stages and format reported by candidates." },
    sponsorshipSignals: { type: "string", description: "Evidence of whether the company sponsors work visas (e.g. H-1B filings)." },
  },
  required: ["summary", "stage", "funding", "headcount", "recentNews", "interviewProcess", "sponsorshipSignals"],
  additionalProperties: false,
};

type Raw = {
  summary?: string; stage?: string; funding?: string; headcount?: string;
  recentNews?: string[]; interviewProcess?: string; sponsorshipSignals?: string;
};

const clean = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function researchCompany(db: Db, companyName: string, domainOrUrl?: string): Promise<CompanyResearch> {
  if (!parallelAvailable()) {
    return { summary: "Research unavailable (no PARALLEL_API_KEY)", citations: [] };
  }
  const input = `Research the company "${companyName}"${domainOrUrl ? ` (website: ${domainOrUrl})` : ""} for a job seeker evaluating whether to apply. ` +
    "Cover what it does, funding and stage, headcount, recent news, what its interview process is like, and whether it sponsors work visas. " +
    "Say \"unknown\" for any field you cannot verify.";
  const { content, basis } = await parallelTaskRun<Raw>(input, OUTPUT_SCHEMA, "core");

  const seen = new Set<string>();
  const citations: CompanyResearch["citations"] = [];
  for (const b of basis) {
    for (const c of b.citations) {
      const key = `${b.field}|${c.url}`;
      if (!c.url || seen.has(key)) continue;
      seen.add(key);
      citations.push({ field: b.field, url: c.url, title: c.title ?? null });
    }
  }
  const research: CompanyResearch = {
    summary: clean(content.summary) ?? "No summary available",
    stage: clean(content.stage),
    funding: clean(content.funding),
    headcount: clean(content.headcount),
    recentNews: Array.isArray(content.recentNews) ? content.recentNews.filter((n): n is string => typeof n === "string" && n.trim() !== "") : undefined,
    interviewProcess: clean(content.interviewProcess),
    sponsorshipSignals: clean(content.sponsorshipSignals),
    citations,
  };

  await db.update(companies)
    .set({ research, researchedAt: new Date() })
    .where(sql`lower(${companies.name}) = ${companyName.trim().toLowerCase()}`);
  return research;
}
