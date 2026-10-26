import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
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

export type MatchJobsOptions = {
  /** Jobs scored at once. Default 6. */
  concurrency?: number;
  /** Epoch ms after which no new job is started; jobs not reached come back with match null. */
  deadline?: number;
};

/** Extract requirements and (re)compute the match row for each job. Failures leave match null. */
export function matchJobs(db: Db, userId: string, jobIds: string[], opts: MatchJobsOptions = {}): Promise<RankedJob[]> {
  return withUserLLM(db, userId, () => matchJobsInner(db, userId, jobIds, opts));
}
async function matchJobsInner(db: Db, userId: string, jobIds: string[], opts: MatchJobsOptions): Promise<RankedJob[]> {
  if (!jobIds.length) return [];
  const queue = [...jobIds];
  const worker = async () => {
    while (queue.length && !(opts.deadline && Date.now() >= opts.deadline)) {
      const id = queue.shift()!;
      try {
        if (await ensureRequirements(db, id, { upgrade: true })) await computeMatch(db, userId, id, retrieveEvidence);
      } catch (err) {
        console.warn(`[match] ${id}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, jobIds.length)) }, worker));
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
/** Words in "find senior frontend roles, remote" that say nothing about which jobs to look at. */
const QUERY_NOISE = new Set(["find", "search", "look", "for", "me", "my", "show", "get", "some", "any", "role", "roles", "job", "jobs", "position", "positions", "opening", "openings", "work", "remote", "remotely", "anywhere", "in", "at", "a", "an", "the", "and", "or", "with", "on", "of", "to", "new", "open", "please", "near", "based", "hybrid"]);

/** The web search (Parallel/Exa) is optional. Without its key (or on a 401/403 key error), search the jobs Nori already holds instead of failing. */
const SEARCH_OFF = /PARALLEL_API_KEY|EXA_API_KEY|No web search is configured|search\/extract\/research is unavailable|(?:Parallel|Exa) search failed: (?:401|403|429)/i;

/** Best matches among jobs already in the database whose title, company or place mention the query. */
async function searchHeld(db: Db, userId: string, query: DiscoverQuery): Promise<RankedJob[]> {
  const words = [...new Set((query.objective ?? "").toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !QUERY_NOISE.has(w)))].slice(0, 6);
  const wantsRemote = /\bremote(ly)?\b/i.test(query.objective ?? "");
  const text = (w: string) => { const p = `%${w.replace(/[%_\\]/g, "")}%`; return or(ilike(jobs.title, p), ilike(jobs.companyName, p), ilike(jobs.location, p)); };
  const rows = await db.select({ id: jobs.id }).from(jobs)
    .where(and(isNull(jobs.closedAt), wantsRemote ? eq(jobs.remote, true) : undefined, words.length ? or(...words.map(text)) : undefined))
    .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt)).limit(300);
  return matchJobs(db, userId, rows.map((r) => r.id));
}

export async function findAndRank(db: Db, userId: string, query: DiscoverQuery, discover = discoverJobs): Promise<{ added: number; jobs: RankedJob[]; heldOnly?: boolean }> {
  const started = Date.now();
  let res: Awaited<ReturnType<typeof discoverJobs>>;
  try { res = await discover(db, query); }
  catch (e) {
    if (!SEARCH_OFF.test((e as Error).message)) throw e;
    return { added: 0, jobs: await searchHeld(db, userId, query), heldOnly: true };
  }
  const rows = await rowsForNormalized(db, res.jobs);
  const deadline = query.budgetMs ? started + query.budgetMs : undefined;
  return { added: res.added, jobs: await matchJobs(db, userId, rows.map((r) => r.id), { deadline }) };
}

export const pct = (m: Pick<MatchResult, "score"> | null | undefined) => (m ? `${Math.round(m.score * 100)}%` : "n/a");
