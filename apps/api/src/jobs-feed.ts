import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, notExists, or, ilike, gte, sql, type SQL } from "drizzle-orm";
import {
  applications, computeMatchesForUser, jobFitsLane, jobs, matches, needsUsCitizenshipOrClearance,
  type Db, type Lane,
} from "@jobgraph/core";

/**
 * The job list behind GET /api/jobs: filtered and ordered in SQL, then lane-fitted, clearance-checked and grouped
 * (same company + title, one row per place) over a page a few times larger than asked for, then trimmed.
 * Lane fit and clearance wording are JS predicates shared with the agent (jobFitsLane, needsUsCitizenshipOrClearance),
 * so they run on the candidate page instead of in SQL; that keeps the request to a handful of indexed-sort reads.
 */
export const STATUS_FILTERS = ["open", "closed", "new", "applied", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const DEFAULT_MAX_AGE_DAYS = 60;
export const MAX_LOCATION_NAMES = 8;
/** Scoring caps how many unscored rows a single request computes. */
export const LAZY_MATCH_CAP = 40;

const DAY_MS = 86_400_000;
const MAX_BATCHES = 4;

export type JobsQuery = {
  q?: string;
  limit: number;
  minScore?: number;
  status: StatusFilter;
  sort: "best" | "new";
  /** 0 = no age limit. Age is coalesce(posted_at, first_seen_at). */
  maxAgeDays: number;
  /** Enabled lanes to fit, or empty for no lane filter. */
  lanes: Lane[];
  group: boolean;
  hideClearance: boolean;
};

/** Effective posting time: when the company posted it, else when Nori first saw it. */
const effectiveAt = sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`;
const since = (days: number) => sql`${effectiveAt} >= ${new Date(Date.now() - days * DAY_MS).toISOString()}::timestamptz`;

/** Key for "the same posting in another place": company and title, case and spacing ignored. */
export const groupKey = (j: { companyName: string; title: string }) =>
  `${j.companyName.trim().toLowerCase()}\u0000${j.title.trim().replace(/\s+/g, " ").toLowerCase()}`;

type Light = Omit<typeof jobs.$inferSelect, "raw" | "descriptionHtml" | "descriptionText"> & { descriptionText?: string };

export async function listJobsForUser(db: Db, userId: string, p: JobsQuery) {
  const hasApp = db.select({ x: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobs.id)));

  // Clauses that define the browsing scope (shared with the sibling-location lookup).
  const scope: SQL[] = [];
  if (p.status === "open") scope.push(isNull(jobs.closedAt));
  if (p.status === "closed") scope.push(isNotNull(jobs.closedAt));
  if (p.status === "new") scope.push(isNull(jobs.closedAt), notExists(hasApp));
  if (p.status === "applied") scope.push(sql`exists (${hasApp})`);
  if (p.status === "all") { /* every row */ }
  if (p.maxAgeDays > 0) scope.push(since(p.maxAgeDays));

  const where: SQL[] = [...scope];
  if (p.q) where.push(or(ilike(jobs.title, `%${p.q}%`), ilike(jobs.companyName, `%${p.q}%`))!);
  if (p.minScore !== undefined && !Number.isNaN(p.minScore)) where.push(gte(matches.score, p.minScore));

  const { raw: _raw, descriptionHtml: _html, descriptionText, ...light } = getTableColumns(jobs);
  const jobCols = p.hideClearance ? { ...light, descriptionText } : light;
  const order = p.sort === "new"
    ? [desc(effectiveAt), desc(jobs.id)]
    : [sql`${matches.score} desc nulls last`, desc(effectiveAt), desc(jobs.id)];
  const batchSize = Math.max(p.limit * 3, 150);

  const page = (offset: number) => db.select({ job: jobCols, match: matches, application: { id: applications.id, status: applications.status } }).from(jobs)
    .leftJoin(matches, and(eq(matches.jobId, jobs.id), eq(matches.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(batchSize).offset(offset);

  /** Walk candidate pages in order, keeping the first row of each group that passes the fit and clearance checks. */
  const collect = async () => {
    const kept: Awaited<ReturnType<typeof page>> = [];
    const seen = new Set<string>();
    for (let b = 0; b < MAX_BATCHES && kept.length < p.limit; b++) {
      const rows = await page(b * batchSize);
      for (const r of rows) {
        const job = r.job as Light;
        if (p.lanes.length && !p.lanes.some((l) => jobFitsLane(job, l))) continue;
        if (p.hideClearance && needsUsCitizenshipOrClearance({ title: job.title, descriptionText: job.descriptionText, requirements: job.requirements })) continue;
        const key = p.group ? groupKey(job) : job.id;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(r);
        if (kept.length >= p.limit) break;
      }
      if (rows.length < batchSize) break;
    }
    return kept;
  };

  let rows = await collect();
  // Score unscored rows on this page (capped) so a fresh account never sees a wall of 0%.
  const unscored = rows.filter((r) => !r.match && !(r.job as Light).closedAt).slice(0, LAZY_MATCH_CAP).map((r) => r.job.id);
  if (unscored.length) {
    const r = await computeMatchesForUser(db, userId, { jobIds: unscored, limit: LAZY_MATCH_CAP });
    if (r.computed) rows = await collect();
  }

  const ids = rows.map((r) => r.job.id);
  const texts = new Map<string, string>();
  if (!p.hideClearance && ids.length) {
    for (const t of await db.select({ id: jobs.id, text: jobs.descriptionText }).from(jobs).where(inArray(jobs.id, ids))) texts.set(t.id, t.text);
  }

  // Every place each kept posting is open in (only rows inside the same browsing scope).
  const places = new Map<string, Set<string>>();
  if (p.group && rows.length) {
    const companies = [...new Set(rows.map((r) => (r.job as Light).companyName.trim().toLowerCase()))];
    const siblings = await db.select({ companyName: jobs.companyName, title: jobs.title, location: jobs.location }).from(jobs)
      .where(and(...scope, inArray(sql`lower(trim(${jobs.companyName}))`, companies)));
    const wanted = new Set(rows.map((r) => groupKey(r.job as Light)));
    for (const s of siblings) {
      const k = groupKey(s);
      if (!wanted.has(k)) continue;
      const loc = s.location?.trim();
      if (loc) (places.get(k) ?? places.set(k, new Set()).get(k)!).add(loc);
    }
  }

  return rows.map((r) => {
    const job = { ...(r.job as Light), descriptionText: (r.job as Light).descriptionText ?? texts.get(r.job.id) ?? "" };
    const base = { job, match: r.match, application: r.application?.id ? r.application : null };
    if (!p.group) return base;
    const own = job.location?.trim();
    const names = [...(places.get(groupKey(job)) ?? [])];
    if (own) names.sort((a, b) => Number(b === own) - Number(a === own)); // the shown row's place first
    return { ...base, locations: Math.max(names.length, 1), locationNames: names.slice(0, MAX_LOCATION_NAMES) };
  });
}

const fitsCache = new Map<string, { at: number; n: number }>();
const FITS_TTL_MS = 60_000;

/** Counts for the line above the jobs list. Every count covers open jobs inside the `maxAgeDays` window (0 = all). */
export async function jobsSummary(db: Db, userId: string, p: { lanes: Lane[]; maxAgeDays: number }) {
  const scope: SQL[] = [isNull(jobs.closedAt)];
  if (p.maxAgeDays > 0) scope.push(since(p.maxAgeDays));
  const cutoff = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
  const [counts] = await db.select({
    open: sql<number>`count(*)::int`,
    newToday: sql<number>`(count(*) filter (where ${effectiveAt} >= ${cutoff(1)}::timestamptz))::int`,
    newThisWeek: sql<number>`(count(*) filter (where ${effectiveAt} >= ${cutoff(7)}::timestamptz))::int`,
  }).from(jobs).where(and(...scope));
  const open = counts?.open ?? 0;

  let fitsLanes = open;
  if (p.lanes.length && open) {
    const key = `${userId}|${JSON.stringify(p.lanes)}|${open}|${p.maxAgeDays}`;
    const hit = fitsCache.get(key);
    if (hit && Date.now() - hit.at < FITS_TTL_MS) fitsLanes = hit.n;
    else {
      const rows = await db.select({ title: jobs.title, location: jobs.location, remote: jobs.remote, n: sql<number>`count(*)::int` }).from(jobs)
        .where(and(...scope)).groupBy(jobs.title, jobs.location, jobs.remote);
      fitsLanes = rows.reduce((sum, r) => sum + (p.lanes.some((l) => jobFitsLane(r, l)) ? r.n : 0), 0);
      if (fitsCache.size > 500) fitsCache.clear();
      fitsCache.set(key, { at: Date.now(), n: fitsLanes });
    }
  }
  return { open, newToday: counts?.newToday ?? 0, newThisWeek: counts?.newThisWeek ?? 0, fitsLanes, hasLanes: p.lanes.length > 0 };
}
