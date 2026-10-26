import { and, count, desc, eq, gte, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  agentEvents, applications, companies, graphNodes, inboxMessages, jobs, matches, profiles, resumes,
  type ApplicationStatus, type AtsType, type Preferences,
} from "../db/schema.js";
import type { DiscoverQuery, OutboundMessage } from "../contracts.js";
import { discoverJobs, searchAvailable } from "../feeds/discover.js";
import { pollTenant } from "../feeds/normalize.js";
import { FEEDS } from "../feeds/registry.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { getGraph, retrieveEvidence } from "../graph/query.js";
import { computeMatch } from "../match/score.js";
import { computeMatchesForUser } from "../runner/jobs.js";
import { ACTIVE_STATUSES, createApplication, runApplication, type Application, type RunnerDeps } from "../runner/runner.js";
import { getProfile } from "../users.js";
import { logAgentEvent } from "./events.js";
import { checkDisqualifiers } from "./gate.js";
import { morningBrief, needsUserNote, replyNote, reviewRequest, splitLong, submittedNote, weeklySummary, type BriefSummary, type WeeklyStats } from "./notify.js";
import { effectiveLanes, jobFitsLane, laneFor } from "./lanes.js";
import { withUserLLM } from "../llm/index.js";
import { assignRefs, PENDING_STATUSES, type PendingRef } from "./pending.js";

export type Notify = (userId: string, msg: OutboundMessage) => Promise<unknown>;

export type AgentTickDeps = {
  runner: RunnerDeps;
  /** Push to the user's channels (the worker wires channels' sendToUser). Without it nothing is pushed. */
  notify?: Notify;
  discover?: (db: Db, q: DiscoverQuery) => Promise<{ added: number }>;
  poll?: (db: Db, atsType: AtsType, token: string) => Promise<{ added: number; ids: string[] }>;
  parallelAvailable?: () => boolean;
  /** Max applications advanced through the runner per tick. Default 5. */
  maxAdvance?: number;
  /** Max open jobs scored per tick. Default 200. */
  scoreLimit?: number;
  /** Max jobs per tick that the model re-reads (rules-only requirements -> model requirements) before queueing. Default 8. */
  maxUpgrades?: number;
  webUrl?: string;
  now?: () => Date;
};

export type TickJob = { id: string; title: string; companyName: string };
export type TickSummary = {
  userId: string;
  at: string;
  discovered: number;
  scored: number;
  queued: number;
  queuedJobs: (TickJob & { applicationId: string; score: number; laneId: string })[];
  skipped: { job: TickJob; reasons: string[]; laneId?: string }[];
  awaitingReview: number;
  submitted: number;
  needsUser: number;
  announced: number;
  errors: string[];
  /** Open jobs that fit an enabled lane (title and place), whatever their score. */
  laneJobs: number;
  /** One plain sentence on why nothing was queued, when that is the case. */
  note?: string;
};

export const DISCOVER_EVERY_MS = 6 * 3600_000;
const FOLLOW_POLL_EVERY_MS = 3600_000;

/** Thrown inside a phase's try block to leave it quietly. */
class SkipPhase extends Error {}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const tickJob = (j: { id: string; title: string; companyName: string }): TickJob => ({ id: j.id, title: j.title, companyName: j.companyName });

/** Local midnight. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Merge keys into profiles.preferences.agent. */
export async function setAgentState(db: Db, userId: string, patch: NonNullable<Preferences["agent"]>) {
  const p = await getProfile(db, userId);
  const prefs = (p.preferences ?? {}) as Preferences;
  await db.update(profiles).set({ preferences: { ...prefs, agent: { ...(prefs.agent ?? {}), ...patch } } }).where(eq(profiles.userId, userId));
}

/** Public boards polled when a deployment has no jobs yet; users' followCompanies take over after that. */
export const STARTER_BOARDS: [AtsType, string][] = [
  ["greenhouse", "vercel"], ["greenhouse", "anthropic"], ["greenhouse", "cloudflare"], ["greenhouse", "figma"],
  ["greenhouse", "stripe"], ["greenhouse", "databricks"], ["ashby", "notion"], ["ashby", "ramp"], ["ashby", "linear"],
];

async function followedTenants(db: Db, userId: string, prefs: Preferences): Promise<{ atsType: AtsType; token: string; lastPolledAt: Date | null }[]> {
  const out = new Map<string, { atsType: AtsType; token: string; lastPolledAt: Date | null }>();
  const add = (atsType: AtsType, token: string, lastPolledAt: Date | null) => {
    if (FEEDS[atsType]) out.set(`${atsType}:${token}`, { atsType, token, lastPolledAt });
  };
  for (const entry of prefs.followCompanies ?? []) {
    const m = /^([a-z0-9_]+):(.+)$/i.exec(entry.trim());
    if (m && FEEDS[m[1]!.toLowerCase() as AtsType]) {
      const [row] = await db.select().from(companies).where(and(eq(companies.atsType, m[1]!.toLowerCase() as AtsType), eq(companies.atsToken, m[2]!))).limit(1);
      add(m[1]!.toLowerCase() as AtsType, m[2]!, row?.lastPolledAt ?? null);
      continue;
    }
    const rows = await db.select().from(companies).where(sql`lower(${companies.name}) = ${entry.trim().toLowerCase()}`).limit(3);
    for (const r of rows) add(r.atsType, r.atsToken, r.lastPolledAt);
  }
  // A fresh install has no boards and no jobs: seed a starter set once so the first tick finds something.
  if (out.size === 0) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(isNull(jobs.closedAt));
    if (n === 0) for (const [atsType, token] of STARTER_BOARDS) add(atsType, token, null);
  }
  // Companies the user already applied to are worth watching too.
  const applied = await db.selectDistinct({ atsType: companies.atsType, token: companies.atsToken, lastPolledAt: companies.lastPolledAt })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.userId, userId));
  for (const r of applied) add(r.atsType, r.token, r.lastPolledAt);
  return [...out.values()];
}

function discoverQueryFrom(prefs: Preferences, remotePreference: string | null): DiscoverQuery | null {
  const titles = (prefs.titles ?? []).filter(Boolean);
  if (!titles.length) return null;
  const locations = (prefs.locations ?? []).filter(Boolean);
  const remote = prefs.remote === "only" || (prefs.remote !== "no" && remotePreference === "remote");
  const objective = `${titles.join(" or ")} roles${remote ? ", remote" : ""}${locations.length ? ` in ${locations.join(" or ")}` : ""}`;
  return { objective, titles, locations, remote, maxResults: 15 };
}

/** Key that changes when an application needs a fresh announcement (new resume, form filled, new questions). */
function announceKey(app: Application): string {
  if (app.status === "needs_user") return `needs_user:${app.pendingQuestions.map((q) => q.label).sort().join("|")}`;
  return `${app.status}:${app.resumeId ?? ""}`;
}

/**
 * One agent cycle for one user: discover, score, gate and queue, advance, announce. Each phase is
 * isolated, so a failing feed or driver never stops the rest; errors land in summary.errors.
 */
const inflight = new Map<string, Promise<TickSummary>>();
/** Is a cycle for this user running right now (scheduled or manual)? */
export const tickRunning = (userId: string) => inflight.has(userId);

export function agentTick(db: Db, userId: string, deps: AgentTickDeps): Promise<TickSummary> {
  // One cycle per user at a time. A manual "Run now" while the scheduled tick is working joins it instead of starting a
  // second one that would score and queue the same jobs again (and fight it for the model).
  const running = inflight.get(userId);
  if (running) return running;
  // Requirements extraction, tailoring and answers inside the tick use this user's models.
  const p = withUserLLM(db, userId, () => tick(db, userId, deps)).finally(() => { inflight.delete(userId); });
  inflight.set(userId, p);
  return p;
}

async function tick(db: Db, userId: string, deps: AgentTickDeps): Promise<TickSummary> {
  const now = deps.now?.() ?? new Date();
  const s: TickSummary = {
    userId, at: now.toISOString(), discovered: 0, scored: 0, queued: 0, queuedJobs: [], skipped: [],
    awaitingReview: 0, submitted: 0, needsUser: 0, announced: 0, errors: [], laneJobs: 0,
  };
  const profile = await getProfile(db, userId);
  const prefs = (profile.preferences ?? {}) as Preferences;
  const notify: Notify = deps.notify ?? (async () => undefined);

  // (a) discovery — poll followed boards concurrently (up to 4 at once) instead of sequentially
  try {
    const dueTenants = (await followedTenants(db, userId, prefs)).filter(
      (t) => !t.lastPolledAt || now.getTime() - t.lastPolledAt.getTime() >= FOLLOW_POLL_EVERY_MS,
    );
    const pollQueue = [...dueTenants];
    const pollWorkers = Array.from({ length: Math.min(4, pollQueue.length) }, async () => {
      for (let t = pollQueue.shift(); t; t = pollQueue.shift()) {
        try {
          const r = await (deps.poll ?? pollTenant)(db, t.atsType, t.token);
          s.discovered += r.added;
        } catch (e) { s.errors.push(`poll ${t.atsType}/${t.token}: ${errMsg(e)}`); }
      }
    });
    await Promise.all(pollWorkers);
    const q = discoverQueryFrom(prefs, profile.remotePreference);
    const last = prefs.agent?.lastDiscoverAt ? Date.parse(prefs.agent.lastDiscoverAt) : 0;
    if (q && (deps.parallelAvailable ?? searchAvailable)() && now.getTime() - last >= DISCOVER_EVERY_MS) {
      await setAgentState(db, userId, { lastDiscoverAt: now.toISOString() });
      try {
        const r = await (deps.discover ?? discoverJobs)(db, q);
        s.discovered += r.added;
      } catch (e) { s.errors.push(`discover: ${errMsg(e)}`); }
    }
    if (s.discovered) await logAgentEvent(db, { userId, kind: "discovered", message: `Found ${s.discovered} new job(s)`, data: { count: s.discovered } });
  } catch (e) { s.errors.push(`discovery: ${errMsg(e)}`); }

  // Without a career graph there is nothing to match against: scoring would burn a model call per job for no result.
  const [{ n: graphSize }] = await db.select({ n: count() }).from(graphNodes).where(eq(graphNodes.userId, userId));
  const hasGraph = Number(graphSize) > 0;

  // (b) scoring
  try {
    if (!hasGraph) throw new SkipPhase();
    // With auto-apply on, only jobs that fit an enabled lane can be queued, so only those are worth an LLM call.
    const scoringLanes = profile.autoApplyDailyCap > 0 ? effectiveLanes(profile).filter((l) => l.enabled) : [];
    const m = await computeMatchesForUser(db, userId, {
      limit: deps.scoreLimit ?? 200,
      ...(scoringLanes.length ? { fits: (j: { title: string; location: string | null; remote: boolean }) => scoringLanes.some((l) => jobFitsLane(j, l)) } : {}),
    });
    s.scored = m.computed;
    if (m.computed) await logAgentEvent(db, { userId, kind: "scored", message: `Scored ${m.computed} job(s) against your graph`, data: { count: m.computed } });
  } catch (e) { if (!(e instanceof SkipPhase)) s.errors.push(`scoring: ${errMsg(e)}`); }

  // (c) gate and queue: every enabled lane, best match first, one shared daily cap
  const why = { remaining: null as number | null, floor: 0, candidates: 0, dupes: 0 };
  const lanes = effectiveLanes(profile).filter((l) => l.enabled);
  try {
    if (hasGraph && lanes.length) {
      const open = await db.select({ title: jobs.title, location: jobs.location, remote: jobs.remote }).from(jobs).where(isNull(jobs.closedAt));
      s.laneJobs = open.filter((j) => lanes.some((l) => jobFitsLane(j, l))).length;
    }
    if (hasGraph && profile.autoApplyDailyCap > 0 && lanes.length) {
      const [{ n }] = await db.select({ n: count() }).from(applications)
        .where(and(eq(applications.userId, userId), gte(applications.createdAt, startOfDay(now))));
      let remaining = profile.autoApplyDailyCap - Number(n);
      why.remaining = remaining;
      const floor = Math.min(...lanes.map((l) => l.minScore));
      why.floor = floor;
      const rows = await db.select({ job: jobs, score: matches.score }).from(matches)
        .innerJoin(jobs, eq(jobs.id, matches.jobId))
        .where(and(
          eq(matches.userId, userId), gte(matches.score, floor), isNull(jobs.closedAt),
          notExists(db.select({ x: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, matches.jobId)))),
          notExists(db.select({ x: agentEvents.id }).from(agentEvents).where(and(eq(agentEvents.userId, userId), eq(agentEvents.kind, "skipped"), eq(agentEvents.jobId, matches.jobId)))),
        ))
        .orderBy(desc(matches.score), sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt))
        .limit(200);
      // Jobs outside every lane are left alone (not logged): lanes change, and the job may fit tomorrow.
      const candidates = rows.flatMap((r) => {
        const lane = laneFor(r.job, lanes, r.score);
        return lane ? [{ ...r, lane }] : [];
      });
      why.candidates = candidates.length;
      const graph = candidates.length ? await getGraph(db, userId) : undefined;
      // The same role is often posted once per city. One application per company and title is enough.
      const roleKey = (company: string, title: string) => `${company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      const taken = new Set((await db.select({ company: jobs.companyName, title: jobs.title }).from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.userId, userId))).map((r) => roleKey(r.company, r.title)));
      let upgrades = deps.maxUpgrades ?? 8;
      for (const cand of candidates) {
        const { job } = cand;
        if (taken.has(roleKey(job.companyName, job.title))) { why.dupes++; continue; }
        let { score, lane } = cand;
        let requirements = job.requirements ?? (await ensureRequirements(db, job.id, { llm: false }));
        let gate = checkDisqualifiers(job, requirements, profile, { graph, now });
        // Scoring used the instant rules-only extraction. A job that passes the checks and could still take a daily-cap
        // slot gets a closer read by the model (bounded per tick), then score, lane and checks are re-evaluated.
        if (gate.ok && remaining > 0 && upgrades > 0 && requirements?.via === "heuristic") {
          upgrades--;
          try {
            const better = await ensureRequirements(db, job.id, { upgrade: true });
            if (better && better.via !== "heuristic") {
              requirements = better;
              score = (await computeMatch(db, userId, job.id, retrieveEvidence)).score;
              const relane = laneFor(job, lanes, score);
              if (!relane) continue; // the closer read dropped it below the lane's bar
              lane = relane;
              gate = checkDisqualifiers(job, requirements, profile, { graph, now });
            }
          } catch (e) { s.errors.push(`requirements ${job.id}: ${errMsg(e)}`); }
        }
        const tj = tickJob(job);
        const laneData = { laneId: lane.id, laneName: lane.name };
        if (!gate.ok) {
          s.skipped.push({ job: tj, reasons: gate.reasons, laneId: lane.id });
          await logAgentEvent(db, {
            userId, kind: "skipped", jobId: job.id, message: `Skipped ${job.title} at ${job.companyName}: ${gate.reasons.join("; ")}`,
            data: { job: { title: job.title, companyName: job.companyName }, reasons: gate.reasons, score, ...laneData },
          });
          continue;
        }
        if (remaining <= 0) continue; // passed the gate, but today's cap is used; reconsidered tomorrow
        const app = await createApplication(db, userId, job.id);
        remaining--;
        why.remaining = remaining;
        taken.add(roleKey(job.companyName, job.title));
        s.queued++;
        s.queuedJobs.push({ ...tj, applicationId: app.id, score, laneId: lane.id });
        await logAgentEvent(db, {
          userId, kind: "queued", jobId: job.id, applicationId: app.id,
          message: `Started ${job.title} at ${job.companyName} (match ${Math.round(score * 100)}%${lane.id === "default" ? "" : `, ${lane.name}`})`,
          data: { job: { title: job.title, companyName: job.companyName }, score, ...laneData },
        });
      }
    }
  } catch (e) { s.errors.push(`queue: ${errMsg(e)}`); }

  if (s.queued === 0) {
    const bar = `${Math.round(why.floor * 100)}%`;
    s.note =
      !hasGraph ? "Your resume has not been read yet, so there is nothing to match jobs against."
      : profile.autoApplyDailyCap <= 0 ? "Auto apply is off: the daily cap is 0. Raise it to let the agent start applications."
      : !lanes.length ? "No lane is enabled. Turn one on or add a lane."
      : why.remaining !== null && why.remaining <= 0 ? "Today's cap is already used. The agent continues tomorrow."
      : s.laneJobs === 0 ? "No open job fits your lane titles and places yet. Widen a lane or wait for new postings."
      : why.candidates === 0 ? `${s.laneJobs} open job${s.laneJobs === 1 ? " fits" : "s fit"} your lanes, but none scores ${bar} or more.`
      : why.dupes === why.candidates ? "Every matching job repeats a role you already applied to."
      : s.skipped.length ? `${why.candidates} job${why.candidates === 1 ? "" : "s"} fit your lanes, but the checks skipped them (see the reasons in the activity feed).`
      : undefined;
  }

  // (d) advance through the runner (up to 2 applications in parallel to overlap LLM tailoring with browser form filling)
  try {
    const active = await db.select().from(applications)
      .where(and(eq(applications.userId, userId), inArray(applications.status, ACTIVE_STATUSES)))
      .orderBy(applications.updatedAt).limit(deps.maxAdvance ?? 5);
    const runQueue = [...active];
    const runWorkers = Array.from({ length: Math.min(2, runQueue.length) }, async () => {
      for (let app = runQueue.shift(); app; app = runQueue.shift()) {
        try {
          const status = await runApplication(db, app.id, deps.runner);
          if (status === "submitted") {
            const [fresh] = await db.select().from(applications).where(eq(applications.id, app.id)).limit(1);
            const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
            s.submitted++;
            await logAgentEvent(db, {
              userId, kind: "submitted", applicationId: app.id, jobId: app.jobId, message: `Submitted ${job.title} at ${job.companyName}`,
              data: { job: { title: job.title, companyName: job.companyName }, dryRun: fresh.receipt?.dryRun ?? false },
            });
            await notify(userId, submittedNote(fresh, job));
          }
        } catch (e) { s.errors.push(`run ${app.id}: ${errMsg(e)}`); }
      }
    });
    await Promise.all(runWorkers);
  } catch (e) { s.errors.push(`advance: ${errMsg(e)}`); }

  // (e) announce what is waiting on the user
  try {
    s.announced = await announceWaiting(db, userId, notify, deps.webUrl);
    const waiting = await db.select({ status: applications.status, n: count() }).from(applications)
      .where(and(eq(applications.userId, userId), inArray(applications.status, PENDING_STATUSES))).groupBy(applications.status);
    for (const w of waiting) {
      if (w.status === "needs_user") s.needsUser = Number(w.n);
      else s.awaitingReview += Number(w.n);
    }
  } catch (e) { s.errors.push(`announce: ${errMsg(e)}`); }

  await setAgentState(db, userId, { lastTickAt: now.toISOString() });
  return s;
}

/** Push a review request / questions note for every waiting application not yet announced in its current state. */
export async function announceWaiting(db: Db, userId: string, notify: Notify, webUrl?: string): Promise<number> {
  const apps = await db.select().from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.status, PENDING_STATUSES))).orderBy(applications.updatedAt);
  if (!apps.length) return 0;
  const done = await db.select({ applicationId: agentEvents.applicationId, data: agentEvents.data }).from(agentEvents)
    .where(and(eq(agentEvents.userId, userId), inArray(agentEvents.kind, ["review_requested", "needs_user"]), inArray(agentEvents.applicationId, apps.map((a) => a.id))));
  const seen = new Set(done.map((d) => `${d.applicationId}|${(d.data as { key?: string }).key}`));
  const todo = apps.filter((a) => !seen.has(`${a.id}|${announceKey(a)}`));
  if (!todo.length) return 0;

  const jobRows = await db.select().from(jobs).where(inArray(jobs.id, todo.map((a) => a.jobId)));
  const jobById = new Map(jobRows.map((j) => [j.id, j]));
  const refs = await assignRefs(db, userId, todo.map((a) => {
    const j = jobById.get(a.jobId)!;
    return { applicationId: a.id, jobId: a.jobId, company: j.companyName, title: j.title, status: a.status };
  }));
  let sent = 0;
  for (const app of todo) {
    const job = jobById.get(app.jobId)!;
    const ref = refs.get(app.id)!;
    const data = { key: announceKey(app), ref, status: app.status, job: { title: job.title, companyName: job.companyName } };
    if (app.status === "needs_user") {
      const { out, long } = splitLong(needsUserNote(app, job, { ref, webUrl }));
      await notify(userId, out);
      await logAgentEvent(db, { userId, kind: "needs_user", applicationId: app.id, jobId: job.id, message: out.text, data: { ...data, long, questions: app.pendingQuestions.map((q) => q.label) } });
    } else {
      const [resume] = app.resumeId ? await db.select().from(resumes).where(eq(resumes.id, app.resumeId)).limit(1) : [];
      const { out, long } = splitLong(reviewRequest(app, job, resume, { ref, webUrl, attach: app.status === "resume_review" }));
      await notify(userId, out);
      await logAgentEvent(db, {
        userId, kind: "review_requested", applicationId: app.id, jobId: job.id, message: out.text,
        data: { ...data, long, atsScore: resume?.atsScore ?? null, changes: resume?.changes.length ?? 0 },
      });
    }
    sent++;
  }
  return sent;
}

/** Items waiting on the user with their reference numbers (assigning numbers where missing). */
export async function waitingRefs(db: Db, userId: string): Promise<PendingRef[]> {
  const apps = await db.select({ id: applications.id, jobId: applications.jobId, status: applications.status, title: jobs.title, company: jobs.companyName })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), inArray(applications.status, PENDING_STATUSES))).orderBy(applications.updatedAt);
  const refs = await assignRefs(db, userId, apps.map((a) => ({ applicationId: a.id, jobId: a.jobId, company: a.company, title: a.title, status: a.status })));
  return apps.map((a) => ({ n: refs.get(a.id)!, applicationId: a.id, jobId: a.jobId, company: a.company, title: a.title, status: a.status as ApplicationStatus }))
    .sort((a, b) => a.n - b.n);
}

async function eventCounts(db: Db, userId: string, since: Date) {
  const rows = await db.select({ kind: agentEvents.kind, data: agentEvents.data }).from(agentEvents)
    .where(and(eq(agentEvents.userId, userId), gte(agentEvents.ts, since)));
  const c = { discovered: 0, scored: 0, queued: 0, submitted: 0, skipped: 0, reply: 0, interview: 0, reasons: new Map<string, number>() };
  for (const r of rows) {
    const d = r.data as { count?: number; reasons?: string[]; byUser?: boolean };
    if (r.kind === "discovered") c.discovered += d.count ?? 0;
    else if (r.kind === "scored") c.scored += d.count ?? 0;
    else if (r.kind === "queued" && !d.byUser) c.queued++;
    else if (r.kind === "submitted") c.submitted++;
    else if (r.kind === "skipped" && d.reasons && !d.byUser) {
      c.skipped++;
      for (const reason of d.reasons) {
        const k = reason.replace(/\d+/g, "N").replace(/ in .*$/, "");
        c.reasons.set(k, (c.reasons.get(k) ?? 0) + 1);
      }
    } else if (r.kind === "reply") c.reply++;
    else if (r.kind === "interview") c.interview++;
  }
  return c;
}

/** Data for the morning brief: the last 24 hours plus what is waiting. */
export async function buildBrief(db: Db, userId: string, now = new Date()): Promise<BriefSummary> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const c = await eventCounts(db, userId, since);
  const top = await db.select({ title: jobs.title, company: jobs.companyName, score: matches.score }).from(matches)
    .innerJoin(jobs, eq(jobs.id, matches.jobId))
    .where(and(
      eq(matches.userId, userId), gte(matches.computedAt, since), isNull(jobs.closedAt),
      notExists(db.select({ x: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, matches.jobId)))),
    ))
    .orderBy(desc(matches.score)).limit(3);
  return { discovered: c.discovered, scored: c.scored, queued: c.queued, submitted: c.submitted, skipped: c.skipped, topMatches: top, waiting: await waitingRefs(db, userId) };
}

export async function buildWeekly(db: Db, userId: string, now = new Date()): Promise<WeeklyStats> {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000);
  const c = await eventCounts(db, userId, since);
  const [{ started }] = await db.select({ started: count() }).from(applications).where(and(eq(applications.userId, userId), gte(applications.createdAt, since)));
  const [{ submitted }] = await db.select({ submitted: count() }).from(applications).where(and(eq(applications.userId, userId), gte(applications.submittedAt, since)));
  const mail = await db.select({ kind: inboxMessages.kind, n: count() }).from(inboxMessages)
    .where(and(eq(inboxMessages.userId, userId), gte(inboxMessages.receivedAt, since))).groupBy(inboxMessages.kind);
  const byKind = new Map(mail.map((m) => [m.kind, Number(m.n)]));
  return {
    started: Number(started), submitted: Number(submitted),
    replies: byKind.get("recruiter_reply") ?? 0, interviews: byKind.get("interview") ?? 0,
    offers: byKind.get("offer") ?? 0, rejections: byKind.get("rejection") ?? 0,
    skipped: c.skipped,
    topSkipReasons: [...c.reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => ({ reason, count: n })),
  };
}

/** Send the morning brief once per local day at or after `hour`. Returns true when sent. */
export async function maybeMorningBrief(db: Db, userId: string, notify: Notify, opts: { hour: number; now?: Date; force?: boolean }): Promise<boolean> {
  const now = opts.now ?? new Date();
  const p = await getProfile(db, userId);
  const today = localDate(now);
  if (!opts.force && (now.getHours() < opts.hour || (p.preferences as Preferences).agent?.lastBriefOn === today)) return false;
  await setAgentState(db, userId, { lastBriefOn: today });
  const { out, long } = splitLong(morningBrief(await buildBrief(db, userId, now)));
  await notify(userId, out);
  await logAgentEvent(db, { userId, kind: "brief", message: out.text, data: { type: "morning", long } });
  return true;
}

/** Weekly summary on Mondays at or after `hour`, once per week. */
export async function maybeWeeklySummary(db: Db, userId: string, notify: Notify, opts: { hour: number; now?: Date; force?: boolean }): Promise<boolean> {
  const now = opts.now ?? new Date();
  const p = await getProfile(db, userId);
  const today = localDate(now);
  if (!opts.force && (now.getDay() !== 1 || now.getHours() < opts.hour || (p.preferences as Preferences).agent?.lastWeeklyOn === today)) return false;
  await setAgentState(db, userId, { lastWeeklyOn: today });
  const msg = weeklySummary(await buildWeekly(db, userId, now));
  await notify(userId, msg);
  await logAgentEvent(db, { userId, kind: "brief", message: msg.text, data: { type: "weekly" } });
  return true;
}

const ANNOUNCE_KINDS = ["recruiter_reply", "interview", "offer", "rejection"] as const;

/** Tell the user about new replies / interviews / offers / rejections in their inbox (once each). */
export async function announceInbox(db: Db, userId: string, notify: Notify, opts: { sinceHours?: number } = {}): Promise<number> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 72) * 3600_000);
  const msgs = await db.select().from(inboxMessages)
    .where(and(eq(inboxMessages.userId, userId), inArray(inboxMessages.kind, [...ANNOUNCE_KINDS]), gte(inboxMessages.receivedAt, since)))
    .orderBy(inboxMessages.receivedAt);
  if (!msgs.length) return 0;
  const done = await db.select({ data: agentEvents.data }).from(agentEvents)
    .where(and(eq(agentEvents.userId, userId), inArray(agentEvents.kind, ["reply", "interview"]), gte(agentEvents.ts, new Date(since.getTime() - 3600_000))));
  const seen = new Set(done.map((d) => (d.data as { inboxId?: string }).inboxId).filter(Boolean));
  let sent = 0;
  for (const m of msgs) {
    if (seen.has(m.id)) continue;
    let job: { id: string; title: string; companyName: string } | undefined;
    if (m.applicationId) {
      [job] = await db.select({ id: jobs.id, title: jobs.title, companyName: jobs.companyName }).from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.id, m.applicationId)).limit(1);
    }
    const msg = replyNote(m, job);
    await notify(userId, msg);
    await logAgentEvent(db, {
      userId, kind: m.kind === "interview" ? "interview" : "reply", applicationId: m.applicationId, jobId: job?.id ?? null, message: msg.text,
      data: { inboxId: m.id, inboxKind: m.kind, ...(job ? { job: { title: job.title, companyName: job.companyName } } : {}) },
    });
    sent++;
  }
  return sent;
}
