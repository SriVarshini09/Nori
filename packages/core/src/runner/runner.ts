import path from "node:path";
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, notExists, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  applications, companies, jobs, matches, profiles, resumes, runEvents, users,
  type ApplicationStatus, type CompanyResearch, type JobRequirements, type PendingQuestion, type Receipt, type ResumeContent,
} from "../db/schema.js";
import type { ApplyDriver, DriverContext, DriverResult, FormField, RenderResult, TailorInput } from "../contracts.js";
import { ensureRequirements } from "../feeds/requirements.js";
import { parallelAvailable } from "../feeds/parallel.js";
import { researchCompany } from "../research/company.js";
import { buildBaselineResume, getGraph, retrieveEvidence } from "../graph/query.js";
import { computeMatch } from "../match/score.js";
import { tailorResume, type TailorOutcome } from "../tailor/rewrite.js";
import { renderPdf } from "../tailor/pdf.js";
import { getProfile } from "../users.js";
import { baselineFromDoc, getDefaultResumeDoc } from "../resume/docs.js";
import { emit } from "./events.js";
import { greenhouseFormUrl } from "../feeds/greenhouse.js";
import { checkDisqualifiers, unprovenConstraints } from "../agent/gate.js";
import { AUTOPILOT_COMPANY_COOLDOWN_DAYS, autopilotVerdict, describeVerdict, type AutopilotMode } from "./autopilot.js";
import { newUsage, runCollectingUsage, withUserLLM } from "../llm/index.js";
import { LIKELY_QUESTIONS, isProfileField, makeAnswerQuestion, toApplicantProfile, type ComposedAnswer } from "./answers.js";

export type Application = typeof applications.$inferSelect;

export type RenderFn = (content: ResumeContent, outPath: string, opts: { requirements?: JobRequirements | null; templateId?: string; theme?: unknown }) =>
  Promise<RenderResult & { content?: ResumeContent }>;

/**
 * Everything the runner needs from outside core. Core cannot import drivers or channels (they depend
 * on core), so apps wire them in: `{ pickDriver, waitForCode: waitForVerificationCode }`.
 */
export type RunnerDeps = {
  pickDriver: (url: string) => ApplyDriver | null;
  /** channels' waitForVerificationCode(db, userId, hint, timeoutMs). Without it, codes time out at once. */
  waitForCode?: (db: Db, userId: string, hint: string, timeoutMs: number) => Promise<string | null>;
  /** PDF renderer; defaults to tailor's renderPdf (launches Chromium). Tests inject a stub. */
  render?: RenderFn;
  /** Bullet tailoring; defaults to tailorResume. */
  tailor?: (input: TailorInput) => Promise<TailorOutcome>;
  /** How often a running step refreshes updatedAt so no other process thinks it stalled. Default STALE_MS / 10. */
  heartbeatMs?: number;
  /** Root for artifacts; default data/artifacts (or ARTIFACTS_DIR). Files land under <root>/<applicationId>/. */
  artifactsRoot?: string;
  /** How many hand-approved applications Autopilot needs before it sends any; default AUTOPILOT_MIN_HUMAN_APPROVALS (tests lower it). */
  autopilotMinApprovals?: number;
  /** Defaults to process.env.ALLOW_REAL_SUBMIT === "true". The driver enforces its own check too. */
  allowRealSubmit?: boolean;
  /** Verification code wait; default 3 minutes. */
  codeTimeoutMs?: number;
  /** Company research before filling (default researchCompany, only when PARALLEL_API_KEY is set). Tests inject a stub. */
  research?: (db: Db, companyName: string, domain?: string) => Promise<CompanyResearch>;
  /** Upper bound on that research call; default 60 s. On timeout or error the fill continues without it. */
  researchTimeoutMs?: number;
  headless?: boolean;
};

export const MAX_ATTEMPTS = 3;
export const WAITING_STATUSES: ApplicationStatus[] = ["resume_review", "form_review", "awaiting_code", "needs_user"];
export const TERMINAL_STATUSES: ApplicationStatus[] = ["submitted", "failed", "skipped", "viewed", "replied", "interview", "offer", "rejected"];
/** Statuses the runner advances without user input. */
export const ACTIVE_STATUSES: ApplicationStatus[] = ["queued", "tailoring", "filling", "submitting"];

export const isStopStatus = (s: ApplicationStatus) => WAITING_STATUSES.includes(s) || TERMINAL_STATUSES.includes(s);

export function artifactsRootOf(deps: Pick<RunnerDeps, "artifactsRoot"> = {}): string {
  return path.resolve(deps.artifactsRoot ?? process.env.ARTIFACTS_DIR ?? "data/artifacts");
}

/** Path relative to the artifacts root (forward slashes) so the API can serve it at /api/artifacts/<rel>. */
export function relArtifactPath(p: string | undefined, root: string): string | undefined {
  if (!p) return p;
  const rel = path.relative(root, path.resolve(p));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return p;
  return rel.split(path.sep).join("/");
}

async function load(db: Db, id: string): Promise<Application> {
  const [app] = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
  if (!app) throw new Error(`Application ${id} not found`);
  return app;
}

async function patch(db: Db, id: string, set: Partial<typeof applications.$inferInsert>): Promise<Application> {
  const [row] = await db.update(applications).set({ ...set, updatedAt: new Date() }).where(eq(applications.id, id)).returning();
  return row;
}

/**
 * Ownership of active steps (tailoring, filling, submitting). A process owns an application after it
 * wins the conditional transition into an active status; another process only takes over once the row
 * has gone stale (no update for STALE_MS, e.g. the owner crashed). This keeps the API and the worker
 * from running the same step twice.
 */
export const STALE_MS = 10 * 60_000;
const owned = new Set<string>();

function track(id: string, status: ApplicationStatus) {
  if (ACTIVE_STATUSES.includes(status)) owned.add(id); else owned.delete(id);
}

async function transition(db: Db, app: Application, status: ApplicationStatus, set: Partial<typeof applications.$inferInsert> = {}, message?: string): Promise<ApplicationStatus> {
  await patch(db, app.id, { ...set, status });
  track(app.id, status);
  await emit(db, app.id, "status", message ?? `${app.status} -> ${status}`, { from: app.status, to: status }, status === "failed" ? "error" : "info");
  return status;
}

/** Move to `status` only if the row is still in `app.status`. False when someone else moved it first. */
async function condTransition(db: Db, app: Application, status: ApplicationStatus, set: Partial<typeof applications.$inferInsert> = {}, message?: string): Promise<boolean> {
  const rows = await db.update(applications).set({ ...set, status, updatedAt: new Date() })
    .where(and(eq(applications.id, app.id), eq(applications.status, app.status)))
    .returning();
  if (!rows.length) return false;
  track(app.id, status);
  await emit(db, app.id, "status", message ?? `${app.status} -> ${status}`, { from: app.status, to: status });
  return true;
}

/** Take over a stale active step. Only one taker wins because the claim refreshes updatedAt. */
async function claimStale(db: Db, app: Application): Promise<boolean> {
  const rows = await db.update(applications).set({ updatedAt: new Date() })
    .where(and(
      eq(applications.id, app.id), eq(applications.status, app.status),
      sql`${applications.updatedAt} < ${new Date(Date.now() - STALE_MS).toISOString()}::timestamptz`,
    ))
    .returning();
  if (!rows.length) return false;
  owned.add(app.id);
  await emit(db, app.id, "recover", `Resuming stale ${app.status} step`, {}, "warn");
  return true;
}

/** Create (or return the existing) application for user+job. Status starts at queued. */
export async function createApplication(db: Db, userId: string, jobId: string): Promise<Application> {
  const now = new Date();
  const [row] = await db.insert(applications).values({ userId, jobId, status: "queued", createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [applications.userId, applications.jobId] }).returning();
  if (row) {
    await emit(db, row.id, "created", "Application queued", { jobId });
    return row;
  }
  const [existing] = await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1);
  return existing;
}

/** Where to resume an application after failure or user input, derived from what is already done. */
export function resumePoint(app: Pick<Application, "resumeId" | "resumeApprovedAt" | "formApprovedAt">): ApplicationStatus {
  if (!app.resumeId) return "queued";
  if (!app.resumeApprovedAt) return "resume_review";
  if (app.formApprovedAt) return "submitting";
  return "filling";
}

// ---------- steps ----------

async function stepTailoring(db: Db, app: Application, deps: RunnerDeps): Promise<ApplicationStatus> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  if (!job) throw new Error(`Job ${app.jobId} not found`);
  const requirements = await ensureRequirements(db, job.id, { upgrade: true });
  if (!requirements) throw new Error(`Could not extract requirements for job ${job.id}`);
  await emit(db, app.id, "requirements", `${requirements.skills.length} skills, ${requirements.mustHaves.length} must-haves`,
    { seniority: requirements.seniority, roleFamily: requirements.roleFamily });

  const match = await computeMatch(db, app.userId, job.id, retrieveEvidence);
  await emit(db, app.id, "match", `Match ${Math.round(match.score * 100)}%`, { score: match.score, reasons: match.reasons, missing: match.missing });

  const profile = await getProfile(db, app.userId);
  const styleDoc = await getDefaultResumeDoc(db, app.userId);
  const baseline = baselineFromDoc(await buildBaselineResume(db, app.userId, profile), styleDoc);
  const style = { templateId: styleDoc?.templateId ?? "classic", theme: styleDoc?.theme ?? {} };
  const evidence = await retrieveEvidence(db, app.userId, requirements);
  const tailor = await (deps.tailor ?? tailorResume)({ baseline, requirements, evidence, jobTitle: job.title, companyName: job.companyName });
  await emit(db, app.id, "tailor",
    `${tailor.changes.length} bullet(s) rewritten${tailor.usedLLM ? "" : " (heuristic)"}, keyword coverage ${Math.round(tailor.keywordCoverage * 100)}%`,
    { changes: tailor.changes.length, rejected: tailor.rejected.length, usedLLM: tailor.usedLLM });

  const [{ n }] = await db.select({ n: count() }).from(resumes).where(eq(resumes.applicationId, app.id));
  const version = Number(n) + 1;
  const outPath = path.join(artifactsRootOf(deps), app.id, `resume-v${version}.pdf`);
  const render = await (deps.render ?? renderPdf)(tailor.content, outPath, { requirements, ...style });
  const [resume] = await db.insert(resumes).values({
    userId: app.userId, applicationId: app.id, version,
    content: render.content ?? tailor.content, provenance: tailor.provenance, changes: tailor.changes,
    html: render.html, pdfPath: render.pdfPath, pages: render.pages, atsScore: render.atsScore, atsChecks: render.atsChecks,
    keywordCoverage: tailor.keywordCoverage, templateId: style.templateId, theme: style.theme as Record<string, unknown>,
  }).returning();
  await emit(db, app.id, "render", `Rendered ${render.pages} page(s), ATS score ${render.atsScore}`,
    { resumeId: resume.id, version, pages: render.pages, atsScore: render.atsScore });

  if (profile.resumeAutoApprove) {
    return transition(db, app, "filling", { resumeId: resume.id, resumeApprovedAt: new Date(), error: null }, "Resume auto-approved (profile setting); filling the form");
  }
  return transition(db, app, "resume_review", { resumeId: resume.id, error: null }, "Resume ready for review");
}

type DriveSetup = {
  ctx: Omit<DriverContext, "dryRun" | "waitForCode">; driver: ApplyDriver; reviewBeforeSubmit: boolean;
  /** Free-text answers the composer wrote during this run, with their sources. */
  composed: Record<string, ComposedAnswer>;
  /** What Autopilot needs to judge the filled form. */
  job: typeof jobs.$inferSelect; requirements: JobRequirements | null; profileRow: typeof profiles.$inferSelect;
};

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => undefined); // a late rejection after the timeout must not go unhandled
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer); }
}

/**
 * The company's stored research, or a fresh run when Parallel is configured and none exists yet. Bounded by
 * researchTimeoutMs; any failure just means the composer works from the job description alone.
 */
async function companyResearchFor(db: Db, app: Application, job: typeof jobs.$inferSelect, deps: RunnerDeps, fetch: boolean): Promise<CompanyResearch | null> {
  const [company] = job.companyId
    ? await db.select().from(companies).where(eq(companies.id, job.companyId)).limit(1)
    : await db.select().from(companies).where(sql`lower(${companies.name}) = ${job.companyName.trim().toLowerCase()}`).limit(1);
  if (company?.research) return company.research;
  if (!fetch || !(deps.research || parallelAvailable())) return null;
  const started = Date.now();
  try {
    const research = await withTimeout((deps.research ?? researchCompany)(db, job.companyName, company?.domain ?? undefined), deps.researchTimeoutMs ?? 60_000, "Company research");
    await emit(db, app.id, "research", `Researched ${job.companyName} in ${Math.round((Date.now() - started) / 1000)}s`, { citations: research.citations.length });
    return research;
  } catch (err) {
    await emit(db, app.id, "research", `Company research skipped: ${err instanceof Error ? err.message : String(err)}`, {}, "warn");
    return null;
  }
}

async function setupDrive(db: Db, app: Application, deps: RunnerDeps, opts: { research?: boolean } = {}): Promise<DriveSetup> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  if (!job) throw new Error(`Job ${app.jobId} not found`);
  if (!app.resumeId) throw new Error("No resume on this application");
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, app.resumeId)).limit(1);
  if (!resume?.pdfPath) throw new Error("Resume has no PDF");
  // A Greenhouse board that redirects to the company's own site: go straight to Greenhouse's embedded form instead.
  const [board] = job.companyId ? await db.select({ token: companies.atsToken }).from(companies).where(eq(companies.id, job.companyId)).limit(1) : [];
  const formUrl = greenhouseFormUrl(job, board?.token) ?? job.applyUrl;
  const driver = deps.pickDriver(formUrl);
  if (!driver) throw new Error(`No apply driver supports ${formUrl}`);
  const profileRow = await getProfile(db, app.userId);
  const [user] = await db.select().from(users).where(eq(users.id, app.userId)).limit(1);
  const profile = toApplicantProfile(profileRow, user?.email ?? "");
  const requirements = await ensureRequirements(db, job.id);
  const evidence = requirements ? await retrieveEvidence(db, app.userId, requirements) : [];
  const research = await companyResearchFor(db, app, job, deps, opts.research ?? false);
  const baseline = await buildBaselineResume(db, app.userId, profileRow);
  const education = (await getGraph(db, app.userId)).nodes.filter((n) => n.type === "education").map((n) => ({ label: n.label, startDate: n.startDate, endDate: n.endDate }));
  const composed: Record<string, ComposedAnswer> = {};
  const answerQuestion = makeAnswerQuestion({
    profile, evidence, jobTitle: job.title, companyName: job.companyName, composed, education,
    compose: {
      job: { id: job.id, title: job.title, companyName: job.companyName, descriptionText: job.descriptionText, requirements },
      research, baseline, preferences: profileRow.preferences as Record<string, unknown>,
    },
  });
  return {
    driver,
    composed,
    job, requirements, profileRow,
    reviewBeforeSubmit: profileRow.reviewBeforeSubmit,
    ctx: {
      applyUrl: formUrl, profile, resumePdfPath: resume.pdfPath, answers: { ...app.answers }, answerQuestion, sessionKey: app.id,
      onEvent: (step, message, data) => { void emit(db, app.id, `driver:${step}`, message, data ?? {}); },
      artifactsDir: path.join(artifactsRootOf(deps), app.id),
      headless: deps.headless,
    },
  };
}

/**
 * applications.answers holds ONLY what the user submitted (/answer, /approve-form). Custom answers the run
 * generated itself (pre-answered questions, driver/LLM answers) live in receipt.autoAnswers and are
 * recomputed on retry. Profile-mapped fields (names, contact, links, location, country, resume) are never
 * stored in either: the driver re-derives them from the current profile on every run.
 */
export type StoredReceipt = Receipt & {
  autoAnswers?: Record<string, string>;
  /** For composed free-text answers: the graph node ids (and "job:description" / research citation URLs) each one draws on. */
  autoAnswerSources?: Record<string, string[]>;
};

export function autoAnswersOf(app: Pick<Application, "receipt">): Record<string, string> {
  return (app.receipt as StoredReceipt | null)?.autoAnswers ?? {};
}

export function autoAnswerSourcesOf(app: Pick<Application, "receipt">): Record<string, string[]> {
  return (app.receipt as StoredReceipt | null)?.autoAnswerSources ?? {};
}

function storeReceipt(receipt: Receipt, root: string, autoAnswers: Record<string, string>, sources: Record<string, string[]> = {}): Receipt {
  const autoAnswerSources = Object.fromEntries(Object.entries(sources).filter(([k]) => k in autoAnswers));
  const stored: StoredReceipt = { ...receipt, screenshotPath: relArtifactPath(receipt.screenshotPath, root), autoAnswers, autoAnswerSources };
  return stored;
}

/**
 * Generated custom answers: pre-answers, composed free-text answers and driver-filled values, minus profile fields
 * and the user's own answers. Composed answers are kept even when the label looks like a profile field ("Cover
 * letter") so the exact reviewed text is what gets submitted.
 */
function collectAuto(pre: Record<string, string>, receipt: Receipt, user: Record<string, string>, composed: Record<string, ComposedAnswer> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const userKeys = new Set(Object.keys(user).map((k) => k.toLowerCase()));
  const add = (label: string, value: string) => {
    if (!value || userKeys.has(label.toLowerCase())) return;
    if (isProfileField(label) && !(label in composed)) return;
    out[label] = value;
  };
  for (const [k, v] of Object.entries(pre)) add(k, v);
  for (const [k, c] of Object.entries(composed)) add(k, c.answer);
  for (const f of receipt.fields) if (f.kind !== "file") add(f.label, f.value);
  return out;
}

const sourcesOf = (composed: Record<string, ComposedAnswer>) => Object.fromEntries(Object.entries(composed).map(([k, c]) => [k, c.sources]));

async function runDriver(db: Db, app: Application, driver: ApplyDriver, ctx: DriverContext): Promise<DriverResult> {
  app.attempts += 1;
  await patch(db, app.id, { attempts: app.attempts });
  await emit(db, app.id, "driver", `${driver.atsType} driver, attempt ${app.attempts}${ctx.dryRun ? " (dry run)" : ""}`,
    { atsType: driver.atsType, dryRun: ctx.dryRun, attempt: app.attempts });
  try {
    return await driver.run(ctx);
  } catch (err) {
    return { outcome: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function failDriver(db: Db, app: Application, res: Extract<DriverResult, { outcome: "failed" }>, root: string): Promise<ApplicationStatus> {
  const left = MAX_ATTEMPTS - app.attempts;
  const shot = relArtifactPath(res.screenshotPath, root);
  // After a submit click, clear the form approval: a retry then refills as a dry run and waits for the person, instead of
  // sending a second copy to the employer.
  return transition(db, app, "failed", { error: res.error, ...(res.submitClicked ? { formApprovedAt: null } : {}) },
    `Driver failed: ${res.error}${left > 0 ? ` (${left} attempt(s) left)` : " (no attempts left)"}${shot ? ` [screenshot ${shot}]` : ""}`);
}

function codeWaiter(db: Db, app: Application, deps: RunnerDeps) {
  return async (hint: string): Promise<string | null> => {
    const timeout = deps.codeTimeoutMs ?? 180_000;
    await patch(db, app.id, { status: "awaiting_code" });
    await emit(db, app.id, "status", `Waiting up to ${Math.round(timeout / 1000)}s for a verification code (${hint})`, { from: app.status, to: "awaiting_code" });
    let code: string | null = null;
    try {
      code = deps.waitForCode ? await deps.waitForCode(db, app.userId, hint, timeout) : null;
    } catch (err) {
      await emit(db, app.id, "verification", `Code lookup failed: ${(err as Error).message}`, {}, "warn");
    }
    // Back to the step that asked, unless the person skipped (or anything else moved it) while we waited.
    await db.update(applications).set({ status: app.status, updatedAt: new Date() })
      .where(and(eq(applications.id, app.id), eq(applications.status, "awaiting_code")));
    await emit(db, app.id, "verification", code ? "Verification code received" : "No verification code arrived in time",
      { found: !!code, to: app.status }, code ? "info" : "warn");
    return code;
  };
}

async function finishSubmitted(db: Db, app: Application, receipt: Receipt): Promise<ApplicationStatus> {
  if (receipt.dryRun) {
    return transition(db, app, "form_review", { receipt, formApprovedAt: null }, "Driver reported a submit during a dry run; not marking submitted");
  }
  return transition(db, app, "submitted", { receipt, submittedAt: new Date(), pendingQuestions: [], error: null },
    receipt.confirmationText ? `Submitted: ${receipt.confirmationText.slice(0, 200)}` : "Submitted");
}

/** Applications the person approved themselves (not Autopilot) that went out: the trust Autopilot is built on. */
export async function countHumanApprovals(db: Db, userId: string): Promise<number> {
  const sent = ["submitted", "viewed", "replied", "interview", "offer", "rejected"] as ApplicationStatus[];
  const [{ n }] = await db.select({ n: count() }).from(applications).where(and(
    eq(applications.userId, userId), eq(applications.autopilot, false), inArray(applications.status, sent), sql`${applications.formApprovedAt} is not null`));
  return Number(n);
}

/** Autopilot's decision for a freshly filled form. Records the checks on the timeline and returns whether it may approve. */
/** Required fields (other than file uploads) that the receipt shows empty after the fill. */
export function unansweredRequired(fields: FormField[], receipt: Receipt): string[] {
  const filled = new Set(receipt.fields.filter((f) => f.value.trim()).map((f) => f.label.trim().toLowerCase()));
  return fields.filter((f) => f.required && f.kind !== "file" && !filled.has(f.label.trim().toLowerCase())).map((f) => f.label);
}

async function judgeByAutopilot(db: Db, app: Application, deps: RunnerDeps, setup: DriveSetup, writtenLabels: string[],
  opts: { mode: AutopilotMode; unanswered: string[] }): Promise<boolean> {
  const { job, requirements, profileRow } = setup;
  const [m] = await db.select({ score: matches.score }).from(matches).where(and(eq(matches.userId, app.userId), eq(matches.jobId, job.id))).limit(1);
  const [resume] = app.resumeId ? await db.select({ atsScore: resumes.atsScore }).from(resumes).where(eq(resumes.id, app.resumeId)).limit(1) : [];
  const graph = await getGraph(db, app.userId);
  const humanApprovals = await countHumanApprovals(db, app.userId);
  const since = new Date(Date.now() - AUTOPILOT_COMPANY_COOLDOWN_DAYS * 86_400_000);
  const [{ n: recent }] = await db.select({ n: count() }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(and(
    eq(applications.userId, app.userId), ne(applications.id, app.id), gte(applications.createdAt, since),
    notInArray(applications.status, ["failed", "skipped"] as ApplicationStatus[]),
    sql`lower(${jobs.companyName}) = ${job.companyName.trim().toLowerCase()}`));
  const verdict = autopilotVerdict({
    mode: opts.mode,
    atsType: setup.driver.atsType,
    submitLockOpen: deps.allowRealSubmit ?? process.env.ALLOW_REAL_SUBMIT === "true",
    score: m?.score ?? null,
    minScore: profileRow.autoApplyMinScore,
    gate: checkDisqualifiers(job, requirements, profileRow, { graph }),
    unproven: unprovenConstraints(job, requirements, profileRow),
    filled: true,
    pendingQuestions: opts.unanswered.length,
    writtenAnswers: writtenLabels,
    atsScore: resume?.atsScore ?? null,
    humanApprovals,
    minHumanApprovals: deps.autopilotMinApprovals,
    recentSameCompany: Number(recent),
  });
  await emit(db, app.id, "autopilot", describeVerdict(verdict), { allowed: verdict.allow, checks: verdict.checks }, verdict.allow ? "info" : "warn");
  return verdict.allow;
}

async function stepFilling(db: Db, app: Application, deps: RunnerDeps): Promise<ApplicationStatus> {
  const root = artifactsRootOf(deps);
  const setup = await setupDrive(db, app, deps, { research: true });
  const { ctx, driver, reviewBeforeSubmit, composed } = setup;
  const user = { ...app.answers };

  // Pre-answer the questions most forms ask, fresh from the current profile and evidence on every run.
  const pre: Record<string, string> = {};
  for (const q of LIKELY_QUESTIONS) {
    if (Object.keys(user).some((k) => k.toLowerCase() === q.label.toLowerCase())) continue;
    const a = await ctx.answerQuestion(q, "");
    if (a) pre[q.label] = a;
  }
  ctx.answers = { ...pre, ...user };

  // The fill is always a dry run. Sending happens only in stepSubmitting, after a person or every Autopilot check approved the
  // filled form. Turning "review before submit" off used to fill with dryRun false and send with no check at all.
  const res = await runDriver(db, app, driver, { ...ctx, dryRun: true, waitForCode: codeWaiter(db, app, deps) });
  const stored = (r: Receipt) => storeReceipt(r, root, collectAuto(pre, r, user, composed), sourcesOf(composed));
  const composedLabels = Object.keys(composed);
  if (composedLabels.length) {
    await emit(db, app.id, "compose", `Wrote ${composedLabels.length} free-text answer(s): ${composedLabels.join("; ").slice(0, 300)}`,
      { labels: composedLabels, usedLLM: Object.values(composed).some((c) => c.usedLLM) });
  }

  switch (res.outcome) {
    case "filled": {
      const receipt = stored(res.receipt);
      // Autopilot may approve the form itself, but only when every check passes (see autopilot.ts); otherwise it waits as always.
      // With "review before submit" off the person has asked not to be asked, so the checks run at least in "safe" mode: that
      // setting skips the question, never the safeguards.
      // Nori pre-writes answers to questions most forms ask, whether or not this form does: only the ones it used count.
      const used = new Set(receipt.fields.map((f) => f.label.trim().toLowerCase()));
      const written = Object.keys(composed).filter((label) => used.has(label.trim().toLowerCase()));
      const profileMode = setup.profileRow.autopilot as AutopilotMode;
      const mode: AutopilotMode = !reviewBeforeSubmit && profileMode === "off" ? "safe" : profileMode;
      const approved = mode !== "off"
        ? await judgeByAutopilot(db, app, deps, setup, written, { mode, unanswered: unansweredRequired(res.fields, res.receipt) })
        : false;
      if (approved) {
        return transition(db, app, "form_review", { receipt, pendingQuestions: [], error: null, formApprovedAt: new Date(), autopilot: true },
          `Form filled (${receipt.fields.length} fields); approved by Autopilot`);
      }
      return transition(db, app, "form_review", { receipt, pendingQuestions: [], error: null }, `Form filled (${receipt.fields.length} fields); waiting for review`);
    }
    case "submitted":
      return finishSubmitted(db, app, stored(res.receipt));
    case "needs_user":
      return transition(db, app, "needs_user", { receipt: stored(res.receipt), pendingQuestions: res.pending },
        `${res.pending.length} question(s) need your answer: ${res.pending.map((p) => p.label).join("; ").slice(0, 300)}`);
    case "failed":
      return failDriver(db, app, res, root);
  }
}

async function stepSubmitting(db: Db, app: Application, deps: RunnerDeps): Promise<ApplicationStatus> {
  // Real sending is switched off on this server: the driver would refuse to click send anyway, so do not re-open the
  // browser and fill the whole form a second time (about as long as the first fill) only to end up here. Record the
  // approval, say plainly that nothing was sent, and hand the form back at once.
  if (!(deps.allowRealSubmit ?? process.env.ALLOW_REAL_SUBMIT === "true")) {
    const receipt = app.receipt ? { ...app.receipt, dryRun: true } : undefined;
    return transition(db, app, "form_review", { ...(receipt ? { receipt } : {}), formApprovedAt: null },
      "Form approved. Real sending is switched off on this server (dry run), so nothing was sent.");
  }
  const root = artifactsRootOf(deps);
  const { ctx, driver, composed } = await setupDrive(db, app, deps);
  // Submit exactly what was reviewed: the fill run's generated answers, overridden by the user's.
  const prevAuto = autoAnswersOf(app);
  const prevSources = autoAnswerSourcesOf(app);
  const user = { ...app.answers };
  ctx.answers = { ...prevAuto, ...user };
  const res = await runDriver(db, app, driver, { ...ctx, dryRun: false, waitForCode: codeWaiter(db, app, deps) });
  const stored = (r: Receipt) => storeReceipt(r, root, { ...prevAuto, ...collectAuto({}, r, user, composed) }, { ...prevSources, ...sourcesOf(composed) });
  switch (res.outcome) {
    case "submitted":
      return finishSubmitted(db, app, stored(res.receipt));
    case "filled": {
      // The driver refused to click submit because ALLOW_REAL_SUBMIT is not "true".
      const receipt = { ...stored(res.receipt), dryRun: true };
      return transition(db, app, "form_review", { receipt, formApprovedAt: null },
        "Form filled but NOT submitted: ALLOW_REAL_SUBMIT is not \"true\" on the server. Set it and approve again to submit for real.");
    }
    case "needs_user": {
      const receipt = stored(res.receipt);
      const code = res.pending.some((p) => p.type === "verification_code");
      const what = code ? "No verification code arrived within the timeout" : `${res.pending.length} question(s) need your answer`;
      if (res.receipt.submitClicked) {
        // Submit was already clicked once. Answering or retrying must not silently send it again: drop the approval so the
        // next run refills as a dry run and the person decides, after checking their email for a confirmation.
        return transition(db, app, "needs_user", { receipt, pendingQuestions: res.pending, formApprovedAt: null },
          `${what}. Nori already clicked submit once, so check your email for a confirmation before you approve it again.`);
      }
      return transition(db, app, "needs_user", { receipt, pendingQuestions: res.pending }, what);
    }
    case "failed":
      return failDriver(db, app, res, root);
  }
}

/**
 * An application left in awaiting_code by a process that stopped mid-wait: nothing picks it up again (it is a waiting
 * status) and only Skip worked. The code wait starts after a submit click, so it goes to the person with the form approval
 * dropped: no automatic second submit. Returns how many were recovered.
 */
export async function recoverStuckCodeWaits(db: Db, olderThanMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await db.update(applications)
    .set({
      status: "needs_user", formApprovedAt: null, updatedAt: new Date(),
      pendingQuestions: [{ label: "Verification code", type: "verification_code", required: true }],
      error: "The wait for a verification code was interrupted. Nori may already have clicked submit: check your email for a confirmation before you approve it again.",
    })
    .where(and(eq(applications.status, "awaiting_code"), lt(applications.updatedAt, cutoff))).returning();
  for (const r of stuck) await emit(db, r.id, "status", "Recovered from an interrupted code wait; waiting for you", { to: "needs_user" }, "warn");
  return stuck.length;
}

/** Advance exactly one step. Returns the status after the step (unchanged when another process owns it). */
export async function stepApplication(db: Db, applicationId: string, deps: RunnerDeps): Promise<ApplicationStatus> {
  const app = await load(db, applicationId);
  const active = async (fn: (a: Application) => Promise<ApplicationStatus>) => {
    if (!owned.has(app.id) && !(await claimStale(db, app))) return app.status;
    // A step can legitimately run longer than STALE_MS (model calls with retries, a slow site, a code wait). Without a
    // heartbeat another process saw it as stalled and ran the same step at the same time: two resume versions, two
    // browsers on one form. While the step runs, updatedAt is refreshed as long as the row is still in this status.
    const beat = setInterval(() => {
      void db.update(applications).set({ updatedAt: new Date() })
        .where(and(eq(applications.id, app.id), eq(applications.status, app.status))).catch(() => {});
    }, deps.heartbeatMs ?? Math.floor(STALE_MS / 10));
    try { return await fn(await load(db, applicationId)); } finally { clearInterval(beat); }
  };
  const gate = async (to: ApplicationStatus, message: string) =>
    (await condTransition(db, app, to, {}, message)) ? to : (await load(db, applicationId)).status;
  try {
    switch (app.status) {
      case "queued":
        return await gate("tailoring", "Tailoring resume");
      case "tailoring":
        return await active((a) => stepTailoring(db, a, deps));
      case "resume_review":
        return app.resumeApprovedAt ? await gate("filling", "Resume approved; filling the form") : app.status;
      case "filling":
        return await active((a) => stepFilling(db, a, deps));
      case "form_review":
        return app.formApprovedAt ? await gate("submitting", "Form approved; submitting") : app.status;
      case "submitting":
        return await active((a) => stepSubmitting(db, a, deps));
      default:
        return app.status;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cur = await load(db, applicationId);
    return transition(db, cur, "failed", { error: message, attempts: cur.attempts + 1 }, `Step ${app.status} failed: ${message}`);
  }
}

const running = new Map<string, Promise<ApplicationStatus>>();

/** Step until a waiting or terminal status. Concurrent calls for the same id in one process are serialized. */
export function runApplication(db: Db, applicationId: string, deps: RunnerDeps): Promise<ApplicationStatus> {
  const inflight = running.get(applicationId);
  if (inflight) return inflight.catch(() => null).then(() => runApplication(db, applicationId, deps));
  const p = (async () => {
    const first = await load(db, applicationId);
    // Tailoring and answers use this user's models (own key, hosted, or local).
    return withUserLLM(db, first.userId, async () => {
      let status = first.status;
      const usage = newUsage();
      try {
        await runCollectingUsage(usage, async () => {
          // Always step once: a gate status may already be approved. Stop when a step makes no progress.
          for (let i = 0; i < 20; i++) {
            const next = await stepApplication(db, applicationId, deps);
            if (next === status) break; // waiting, terminal, or owned by another process
            status = next;
          }
        });
      } finally {
        // What this run cost in model tokens, so the person can see it on the application page.
        if (usage.calls) {
          await emit(db, applicationId, "usage",
            `Model use this run: about ${usage.totalTokens.toLocaleString("en-US")} tokens over ${usage.calls} call${usage.calls === 1 ? "" : "s"}${usage.model ? ` (${usage.model})` : ""}`,
            { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, calls: usage.calls, model: usage.model ?? null, estimated: usage.estimated ?? false });
        }
      }
      return status;
    });
  })().finally(() => running.delete(applicationId));
  running.set(applicationId, p);
  return p;
}

export function isRunning(applicationId: string): boolean {
  return running.has(applicationId);
}

// ---------- user actions ----------

export async function approveResume(db: Db, id: string, deps: RunnerDeps): Promise<ApplicationStatus> {
  const app = await load(db, id);
  if (!app.resumeId) throw new Error("No resume to approve yet");
  await patch(db, id, { resumeApprovedAt: app.resumeApprovedAt ?? new Date() });
  await emit(db, id, "approve_resume", "Resume approved");
  return runApplication(db, id, deps);
}

export async function approveForm(db: Db, id: string, deps: RunnerDeps, answers?: Record<string, string>): Promise<ApplicationStatus> {
  const app = await load(db, id);
  if (app.status !== "form_review") throw new Error(`Application is ${app.status}, not form_review`);
  // Keep only real edits: a value equal to what the run filled or generated is not a user answer.
  const filled = new Map((app.receipt?.fields ?? []).map((f) => [f.label, f.value]));
  const auto = autoAnswersOf(app);
  const edits = Object.fromEntries(Object.entries(answers ?? {}).filter(([k, v]) =>
    k in app.answers || (v !== filled.get(k) && v !== auto[k])));
  await patch(db, id, { formApprovedAt: new Date(), answers: { ...app.answers, ...edits } });
  await emit(db, id, "approve_form", `Form approved${Object.keys(edits).length ? ` with ${Object.keys(edits).length} edited answer(s)` : ""}`);
  return runApplication(db, id, deps);
}

/**
 * Save answers to pending questions and, when the application was waiting on them, move it on to where the run stopped.
 * Only quick database writes: the caller replies as soon as this returns, so the person's very next request (usually
 * "approve") sees the answers saved and the application already moving. `resume` says whether the run should now continue.
 */
export async function acceptAnswers(db: Db, id: string, answers: Record<string, string>): Promise<{ status: ApplicationStatus; resume: boolean }> {
  const app = await load(db, id);
  const still: PendingQuestion[] = app.pendingQuestions.filter((q) => !(q.label in answers));
  const updated = await patch(db, id, { answers: { ...app.answers, ...answers }, pendingQuestions: still });
  await emit(db, id, "answer", `Answered ${Object.keys(answers).length} question(s)`, { labels: Object.keys(answers) });
  if (app.status !== "needs_user") return { status: app.status, resume: false };
  await condTransition(db, updated, resumePoint(updated), { error: null }, "Resuming with your answers");
  return { status: resumePoint(updated), resume: true };
}

/** Answer pending questions, then resume from where the run stopped. */
export async function answerPending(db: Db, id: string, deps: RunnerDeps, answers: Record<string, string>): Promise<ApplicationStatus> {
  const r = await acceptAnswers(db, id, answers);
  return r.resume ? runApplication(db, id, deps) : r.status;
}

export async function skipApplication(db: Db, id: string): Promise<ApplicationStatus> {
  return transition(db, await load(db, id), "skipped", {}, "Skipped by user");
}

/**
 * Answers minus profile-mapped values that earlier runs (before answers were user-only) copied in from
 * the driver's fill or the runner's pre-answers. A profile field the user typed themselves is kept.
 */
export function staleFreeAnswers(app: Pick<Application, "answers" | "receipt">): Record<string, string> {
  const filled = new Map((app.receipt?.fields ?? []).map((f) => [f.label, f.value]));
  const generated = new Set(LIKELY_QUESTIONS.map((q) => q.label));
  return Object.fromEntries(Object.entries(app.answers).filter(([k, v]) =>
    !(isProfileField(k) && (filled.get(k) === v || generated.has(k)))));
}

/**
 * Retry a failed / needs_user application from the step it stopped at. A user retry (force, the default)
 * resets the attempt counter; without force it refuses after MAX_ATTEMPTS (the worker's auto-retry).
 */
export async function retryApplication(db: Db, id: string, deps: RunnerDeps, opts: { force?: boolean } = {}): Promise<ApplicationStatus> {
  const force = opts.force ?? true;
  const app = await load(db, id);
  if (!force && app.attempts >= MAX_ATTEMPTS) {
    await emit(db, id, "retry", `Not retrying: ${app.attempts} of ${MAX_ATTEMPTS} attempts used`, {}, "warn");
    return app.status;
  }
  if ((["failed", "needs_user", "skipped"] as ApplicationStatus[]).includes(app.status)) {
    await condTransition(db, app, resumePoint(app), {
      error: null, ...(force ? { attempts: 0 } : {}),
      // Recompute generated answers fresh, and drop profile values older runs copied into answers.
      answers: staleFreeAnswers(app),
      receipt: app.receipt ? { ...app.receipt, autoAnswers: undefined, autoAnswerSources: undefined } as StoredReceipt : null,
    }, "Retrying");
  }
  return runApplication(db, id, deps);
}

export { skipApplication as skip, retryApplication as retry };

// ---------- auto apply / worker helpers ----------

/** Queue applications for the best open matches above autoApplyMinScore, up to autoApplyDailyCap per UTC day. */
export async function autoApplyTick(db: Db, userId: string): Promise<{ created: string[] }> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile || profile.autoApplyDailyCap <= 0) return { created: [] };
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: count() }).from(runEvents)
    .innerJoin(applications, eq(applications.id, runEvents.applicationId))
    .where(and(eq(applications.userId, userId), eq(runEvents.step, "auto_apply"), gte(runEvents.ts, dayStart)));
  const remaining = profile.autoApplyDailyCap - Number(n);
  if (remaining <= 0) return { created: [] };

  const candidates = await db.select({ jobId: matches.jobId, score: matches.score }).from(matches)
    .innerJoin(jobs, eq(jobs.id, matches.jobId))
    .where(and(
      eq(matches.userId, userId), gte(matches.score, profile.autoApplyMinScore), isNull(jobs.closedAt),
      notExists(db.select({ x: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, matches.jobId)))),
    ))
    .orderBy(desc(matches.score)).limit(remaining);
  const created: string[] = [];
  for (const c of candidates) {
    const app = await createApplication(db, userId, c.jobId);
    await emit(db, app.id, "auto_apply", `Auto-apply: match ${Math.round(c.score * 100)}% >= ${Math.round(profile.autoApplyMinScore * 100)}%`, { score: c.score });
    created.push(app.id);
  }
  return { created };
}

/** Applications the worker should advance: queued ones, and active ones whose lease (updatedAt) went stale. */
export async function pickRunnable(db: Db, opts: { staleMs?: number; limit?: number } = {}): Promise<Application[]> {
  const staleBefore = new Date(Date.now() - (opts.staleMs ?? STALE_MS));
  const rows = await db.select().from(applications).where(inArray(applications.status, ACTIVE_STATUSES))
    .orderBy(applications.updatedAt).limit(opts.limit ?? 20);
  return rows.filter((r) => r.status === "queued" || r.updatedAt < staleBefore);
}
