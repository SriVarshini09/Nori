import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { graphNodes, jobs, matches } from "../db/schema.js";
import type { DiscoverQuery, MatchResult, NormalizedJob } from "../contracts.js";
import { discoverJobs } from "../feeds/discover.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { retrieveEvidence } from "../graph/query.js";
import { computeMatch } from "../match/score.js";
import { withUserLLM } from "../llm/index.js";

export type JobRowT = typeof jobs.$inferSelect;
export type MatchRowT = typeof matches.$inferSelect;
export type RankedJob = { job: JobRowT; match: MatchRowT | null };

/** Extract requirements and (re)compute the match row for each job. Failures leave match null. */
export function matchJobs(db: Db, userId: string, jobIds: string[]): Promise<RankedJob[]> {
  return withUserLLM(db, userId, () => matchJobsInner(db, userId, jobIds));
}
async function matchJobsInner(db: Db, userId: string, jobIds: string[]): Promise<RankedJob[]> {
  if (!jobIds.length) return [];
  for (const id of jobIds) {
    try {
      if (await ensureRequirements(db, id, { upgrade: true })) await computeMatch(db, userId, id, retrieveEvidence);
    } catch (err) {
      console.warn(`[match] ${id}: ${(err as Error).message}`);
    }
  }
  const rows = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const ms = await db.select().from(matches).where(and(eq(matches.userId, userId), inArray(matches.jobId, jobIds)));
  const byJob = new Map(ms.map((m) => [m.jobId, m]));
  return rows.map((job) => ({ job, match: byJob.get(job.id) ?? null }))
    .sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
}

export type ComputeMatchesOptions = {
  /** Max jobs to score in this call (newest first). Default 300. */
  limit?: number;
  /** Parallel workers. Default 4. */
  concurrency?: number;
  /** Also rescore jobs whose match was computed before this time (the graph changed since). */
  staleBefore?: Date;
  /** Only consider these job ids. */
  jobIds?: string[];
  /**
   * Cheap pre-filter on the job row. Scoring costs an LLM call per job, so the agent only scores jobs it could
   * actually queue (those that fit a lane) instead of every open job on a board.
   */
  fits?: (job: { title: string; location: string | null; remote: boolean }) => boolean;
};

/**
 * Score the newest open jobs that have no match for this user (or a stale one), extracting
 * requirements as needed, and upsert the match rows. Per-job failures are logged and counted.
 */
export function computeMatchesForUser(db: Db, userId: string, opts: ComputeMatchesOptions = {}): Promise<{ computed: number; failed: number; jobIds: string[] }> {
  return withUserLLM(db, userId, () => computeMatchesInner(db, userId, opts));
}
async function computeMatchesInner(db: Db, userId: string, opts: ComputeMatchesOptions): Promise<{ computed: number; failed: number; jobIds: string[] }> {
  const { limit = 300, concurrency = 4, staleBefore, jobIds, fits } = opts;
  if (jobIds && !jobIds.length) return { computed: 0, failed: 0, jobIds: [] };
  const missing = staleBefore ? or(isNull(matches.jobId), lt(matches.computedAt, staleBefore)) : isNull(matches.jobId);
  const base = db.select({ id: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote }).from(jobs)
    .leftJoin(matches, and(eq(matches.jobId, jobs.id), eq(matches.userId, userId)))
    .where(and(isNull(jobs.closedAt), missing, jobIds ? inArray(jobs.id, jobIds) : undefined))
    .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt));
  const rows = fits ? (await base).filter((r) => fits(r)).slice(0, limit) : await base.limit(limit);
  const ids = rows.map((r) => r.id);
  let next = 0, computed = 0, failed = 0;
  const work = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        // Rules only: this runs over hundreds or thousands of jobs, and a model call per job would never finish on a local model.
        if (await ensureRequirements(db, id, { llm: false })) { await computeMatch(db, userId, id, retrieveEvidence); computed++; }
      } catch (err) {
        failed++;
        console.warn(`[match] ${id}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, work));
  return { computed, failed, jobIds: ids };
}

/** Users with at least one career-graph node (worth scoring jobs for). */
export async function usersWithGraph(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: graphNodes.userId }).from(graphNodes);
  return rows.map((r) => r.userId);
}

/** Rows for normalized jobs, looked up by (atsType, externalId). */
export async function rowsForNormalized(db: Db, list: NormalizedJob[]): Promise<JobRowT[]> {
  if (!list.length) return [];
  return db.select().from(jobs).where(or(...list.map((j) => and(eq(jobs.atsType, j.atsType), eq(jobs.externalId, j.externalId)))));
}

/** Parallel search -> upsert -> match. Best match first. */
export async function findAndRank(db: Db, userId: string, query: DiscoverQuery, discover = discoverJobs): Promise<{ added: number; jobs: RankedJob[] }> {
  const res = await discover(db, query);
  const rows = await rowsForNormalized(db, res.jobs);
  return { added: res.added, jobs: await matchJobs(db, userId, rows.map((r) => r.id)) };
}

export const pct = (m: Pick<MatchResult, "score"> | null | undefined) => (m ? `${Math.round(m.score * 100)}%` : "n/a");
