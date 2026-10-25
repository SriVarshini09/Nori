import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { jobs, outreach } from "../db/schema.js";
import { exaAvailable, exaSearch } from "../feeds/exa.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { getGraph, retrieveEvidence } from "../graph/query.js";
import { FLUFF_RE } from "../tailor/fluff.js";
import { getProfile } from "../users.js";

/**
 * Stage 7: People at <company> Outreach Discovery & Provenance-Safe Note Drafter.
 *
 * Finds relevant engineering / hiring contacts at the company (via Exa's LinkedIn/web index when
 * configured, or role-aware contact slots when offline) and drafts a short, factual note grounded
 * strictly in the user's Career Graph nodes — never inventing a shared connection or unverified claim.
 */

export type OutreachContact = {
  id: string;
  personName: string;
  personTitle: string;
  personUrl: string | null;
  companyName: string;
  draftText: string;
  sources: string[];
  status: "draft" | "sent" | "replied";
  sentAt: Date | null;
  followUpAt: Date | null;
};

function parseLinkedInPersonTitle(rawTitle: string, companyName: string): { name: string; role: string } | null {
  const cleaned = rawTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const parts = cleaned.split(/\s*[-–—]\s*/);
  if (parts.length >= 2) {
    const name = parts[0]!.trim();
    const role = parts[1]!.replace(new RegExp(`\\bat\\s+${companyName}\\b`, "i"), "").trim() || `Team Member at ${companyName}`;
    if (name.length >= 3 && name.length <= 60) return { name, role };
  }
  return null;
}

export function buildProvenanceOutreachDraft(opts: {
  personName: string;
  personTitle: string;
  companyName: string;
  jobTitle: string;
  applicantName: string;
  topSkills: string[];
  metricStatement?: string;
  sourceNodeIds: string[];
}): { draftText: string; sources: string[] } {
  const firstName = opts.personName.split(/\s+/)[0] || "there";
  const skillsLine = opts.topSkills.length
    ? `working with ${opts.topSkills.slice(0, 3).join(", ")}`
    : `building production software`;
  const metricClause = opts.metricStatement
    ? ` (${opts.metricStatement.replace(/[.;]+$/, "")})`
    : "";
  const signoff = opts.applicantName ? `\n\nBest,\n${opts.applicantName}` : "";

  const body = `Hi ${firstName}, I applied for the ${opts.jobTitle} role at ${opts.companyName} and noticed your work as ${opts.personTitle}. My recent experience includes ${skillsLine}${metricClause}. Would love to share my one-page resume if helpful.${signoff}`;
  const cleaned = body.replace(FLUFF_RE, "").replace(/\s{2,}/g, " ").trim();
  return { draftText: cleaned, sources: opts.sourceNodeIds };
}

export async function findAndDraftOutreach(
  db: Db,
  userId: string,
  jobId: string,
): Promise<OutreachContact[]> {
  const existing = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.userId, userId), eq(outreach.jobId, jobId)))
    .orderBy(desc(outreach.createdAt));
  if (existing.length > 0) return existing;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error("Job not found");

  const [profile, graph, reqs] = await Promise.all([
    getProfile(db, userId),
    getGraph(db, userId),
    ensureRequirements(db, jobId, { llm: false }),
  ]);
  const evidence = reqs ? await retrieveEvidence(db, userId, reqs) : [];
  const realEvidence = evidence.filter((e) => !e.inferred);
  const topSkills = [...new Set(realEvidence.filter((e) => e.nodeType === "skill" || e.nodeType === "tool").map((e) => e.label))].slice(0, 3);
  if (topSkills.length === 0) {
    for (const n of graph.nodes) {
      if ((n.type === "skill" || n.type === "tool") && topSkills.length < 3) topSkills.push(n.label);
    }
  }
  const metricNode = realEvidence.find((e) => e.nodeType === "metric" && /\d/.test(e.text))
    ?? graph.nodes.find((n) => n.type === "metric" && /\d/.test(n.label));
  const metricStatement = metricNode ? ("text" in metricNode ? metricNode.text : metricNode.label) : undefined;
  const sourceNodeIds = [...new Set([
    ...realEvidence.slice(0, 3).map((e) => e.nodeId),
    ...(metricNode && "id" in metricNode ? [metricNode.id] : []),
  ])];

  let people: { name: string; title: string; url: string | null }[] = [];
  if (exaAvailable()) {
    try {
      const hits = await exaSearch({
        query: `"${job.companyName}" (${job.title} OR "Engineering Manager" OR "Technical Recruiter")`,
        includeDomains: ["linkedin.com"],
        numResults: 5,
      });
      for (const h of hits) {
        if (!h.url.includes("/in/")) continue;
        const parsed = parseLinkedInPersonTitle(h.title ?? "", job.companyName);
        if (parsed) {
          people.push({ name: parsed.name, title: parsed.role, url: h.url });
        }
      }
    } catch {
      /* fall back to role-based contacts below */
    }
  }

  if (people.length === 0) {
    people = [
      { name: `${job.companyName} Hiring Team`, title: `Engineering Manager (${job.title})`, url: null },
      { name: `${job.companyName} Recruiting`, title: `Technical Recruiter at ${job.companyName}`, url: null },
      { name: `${job.companyName} Team Lead`, title: `Senior Lead, ${job.title}`, url: null },
    ];
  }

  const created: OutreachContact[] = [];
  for (const p of people.slice(0, 3)) {
    const { draftText, sources } = buildProvenanceOutreachDraft({
      personName: p.name,
      personTitle: p.title,
      companyName: job.companyName,
      jobTitle: job.title,
      applicantName: profile.fullName ?? "",
      topSkills,
      metricStatement,
      sourceNodeIds,
    });
    const [row] = await db
      .insert(outreach)
      .values({
        userId,
        jobId: job.id,
        personName: p.name,
        personTitle: p.title,
        personUrl: p.url,
        companyName: job.companyName,
        draftText,
        sources,
        status: "draft",
      })
      .returning();
    if (row) created.push(row);
  }
  return created;
}

export async function markOutreachSent(db: Db, userId: string, outreachId: string): Promise<OutreachContact | null> {
  const now = new Date();
  const followUpAt = new Date(now.getTime() + 5 * 86_400_000); // 5-day follow-up reminder
  const [row] = await db
    .update(outreach)
    .set({ status: "sent", sentAt: now, followUpAt })
    .where(and(eq(outreach.id, outreachId), eq(outreach.userId, userId)))
    .returning();
  return row ?? null;
}
