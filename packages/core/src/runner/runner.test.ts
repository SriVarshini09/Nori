import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { applications, jobs, profiles, resumes, runEvents } from "../db/schema.js";
import type { ApplyDriver, DriverContext, DriverResult, FormField } from "../contracts.js";
import { ensureDefaultUser } from "../users.js";
import { ingestResume } from "../graph/ingest.js";
import { renderHtml } from "../tailor/template.js";
import { atsChecks } from "../tailor/ats.js";
import {
  answerPending, approveForm, approveResume, autoApplyTick, autoAnswersOf, retryApplication, createApplication, runApplication, stepApplication,
  heuristicAnswer, onRunEvent, autoAnswerSourcesOf, lint, type RenderFn, type RunnerDeps,
} from "./index.js";

const SAMPLE_RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com | (415) 555-0199 | linkedin.com/in/jordanrivera

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments

Software Engineer | Brightside Analytics | Mar 2019 - Dec 2021
• Developed a Python and Airflow ETL pipeline ingesting 2M events per day
• Shipped a customer-facing React dashboard used by 1,200 customers

EDUCATION
B.S. in Computer Science, University of Washington
2013 - 2017

SKILLS
Languages: Python, TypeScript, JavaScript, SQL
`;

const JOB_TEXT = `We are hiring a Senior Frontend Engineer.
Requirements:
- 5+ years of experience with React and TypeScript
- Experience with Node.js and PostgreSQL
Nice to have:
- Python, GraphQL`;

type FakeMode = "fill" | "needs_user" | "refuse_submit";

/** Never launches a browser. Records every context it was run with. */
class FakeDriver implements ApplyDriver {
  atsType = "web" as const;
  calls: DriverContext[] = [];
  constructor(public mode: FakeMode = "fill") {}
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    this.calls.push(ctx);
    ctx.onEvent("navigate", `Opening ${ctx.applyUrl}`);
    const receipt = (dryRun: boolean) => ({
      fields: [
        { label: "First Name", value: ctx.profile.firstName, kind: "text" },
        { label: "Email", value: ctx.answers.Email ?? ctx.profile.email, kind: "email" },
        { label: "Github", value: ctx.answers.Github ?? ctx.profile.github ?? ctx.profile.website ?? "", kind: "text" },
        { label: "Why Acme?", value: ctx.answers["Why Acme?"] ?? "Generated answer", kind: "textarea" },
        { label: "Resume", value: "resume.pdf", kind: "file" },
        ...(ctx.answers["Favorite color"] ? [{ label: "Favorite color", value: ctx.answers["Favorite color"], kind: "text" }] : []),
      ],
      files: [ctx.resumePdfPath], screenshotPath: path.join(ctx.artifactsDir, "filled.png"),
      submittedVia: "fake", dryRun, durationMs: 1,
    });
    if (this.mode === "needs_user" && !ctx.answers["Favorite color"]) {
      return { outcome: "needs_user", pending: [{ label: "Favorite color", type: "text", required: true }], receipt: receipt(ctx.dryRun) };
    }
    if (ctx.dryRun || this.mode === "refuse_submit") return { outcome: "filled", receipt: receipt(true), fields: [] };
    return { outcome: "submitted", receipt: { ...receipt(false), confirmationText: "Thank you for applying" } };
  }
}

let db: Db;
let userId: string;
let jobId: string;
let root: string;

const stubRender: RenderFn = async (content, outPath, opts) => {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, "%PDF-1.4 stub");
  const html = renderHtml(content);
  const ats = atsChecks(content, html, opts.requirements ?? undefined, 1);
  return { html, pdfPath: outPath, pages: 1, atsScore: ats.score, atsChecks: ats.checks };
};

function deps(driver: ApplyDriver): RunnerDeps {
  return { pickDriver: () => driver, render: stubRender, artifactsRoot: root, allowRealSubmit: true };
}

async function steps(appId: string): Promise<string[]> {
  const rows = await db.select().from(runEvents).where(eq(runEvents.applicationId, appId)).orderBy(asc(runEvents.ts));
  return rows.map((r) => r.step);
}

async function app(id: string) {
  const [row] = await db.select().from(applications).where(eq(applications.id, id));
  return row;
}

beforeEach(async () => {
  db = await openTestDb();
  root = await mkdtemp(path.join(os.tmpdir(), "jobgraph-runner-"));
  userId = (await ensureDefaultUser(db)).id;
  await ingestResume(db, userId, SAMPLE_RESUME);
  await db.update(profiles).set({ fullName: "Jordan Rivera", workAuth: { authorizedUS: true, needsSponsorship: false } }).where(eq(profiles.userId, userId));
  const [job] = await db.insert(jobs).values({
    companyName: "Acme", atsType: "web", externalId: "acme-1", title: "Senior Frontend Engineer",
    descriptionText: JOB_TEXT, applyUrl: "https://example.com/jobs/1",
  }).returning();
  jobId = job.id;
});

describe("runner", () => {
  it("walks queued -> resume_review -> form_review -> submitted with both gates", async () => {
    const driver = new FakeDriver();
    const d = deps(driver);
    const created = await createApplication(db, userId, jobId);
    expect(created.status).toBe("queued");
    expect((await createApplication(db, userId, jobId)).id).toBe(created.id); // unique per user+job

    const seen: string[] = [];
    const off = onRunEvent(created.id, (e) => seen.push(e.step));

    expect(await stepApplication(db, created.id, d)).toBe("tailoring");
    expect(await stepApplication(db, created.id, d)).toBe("resume_review");
    expect(await runApplication(db, created.id, d)).toBe("resume_review"); // gate holds

    let a = await app(created.id);
    expect(a.resumeId).toBeTruthy();
    const [resume] = await db.select().from(resumes).where(eq(resumes.id, a.resumeId!));
    expect(resume.version).toBe(1);
    expect(resume.pdfPath).toContain(path.join(created.id, "resume-v1.pdf"));
    expect(resume.pages).toBe(1);
    expect(resume.atsChecks.length).toBeGreaterThan(0);
    expect(driver.calls).toHaveLength(0);

    expect(await approveResume(db, created.id, d)).toBe("form_review");
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0].dryRun).toBe(true);
    a = await app(created.id);
    expect(a.receipt?.dryRun).toBe(true);
    expect(a.receipt?.screenshotPath).toBe(`${created.id}/filled.png`); // relative to artifacts root
    expect(a.answers).toEqual({}); // user-only: nothing submitted yet
    const auto = autoAnswersOf(a);
    expect(auto["Are you legally authorized to work in the United States?"]).toBe("Yes");
    expect(auto["Will you now or in the future require sponsorship for employment visa status?"]).toBe("No");
    expect(auto["Why Acme?"]).toBe("Generated answer");
    expect(auto["First Name"]).toBeUndefined(); // profile fields are never stored
    expect(auto.Github).toBeUndefined();
    expect(a.attempts).toBe(1);

    expect(await approveForm(db, created.id, d, { Email: "edited@example.com" })).toBe("submitted");
    expect(driver.calls).toHaveLength(2);
    expect(driver.calls[1].dryRun).toBe(false);
    expect(driver.calls[1].answers.Email).toBe("edited@example.com");
    a = await app(created.id);
    expect(a.submittedAt).toBeTruthy();
    expect(a.receipt?.confirmationText).toBe("Thank you for applying");
    off();

    const s = await steps(created.id);
    for (const step of ["created", "status", "requirements", "match", "tailor", "render", "approve_resume", "driver", "driver:navigate", "approve_form"]) {
      expect(s).toContain(step);
    }
    expect(seen).toContain("render");
  });

  it("stays in form_review when the driver refuses the real submit", async () => {
    const driver = new FakeDriver("refuse_submit");
    const d = deps(driver);
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, d);
    await approveResume(db, id, d);
    expect(await approveForm(db, id, d)).toBe("form_review");
    const a = await app(id);
    expect(a.formApprovedAt).toBeNull();
    expect(a.receipt?.dryRun).toBe(true);
    const [last] = await db.select().from(runEvents).where(eq(runEvents.applicationId, id)).orderBy(asc(runEvents.ts)).then((r) => r.slice(-1));
    expect(last.message).toMatch(/ALLOW_REAL_SUBMIT/);
  });

  it("goes to needs_user for unanswered questions and resumes after answers", async () => {
    const driver = new FakeDriver("needs_user");
    const d = deps(driver);
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("needs_user");
    let a = await app(id);
    expect(a.pendingQuestions).toEqual([{ label: "Favorite color", type: "text", required: true }]);
    expect(await answerPending(db, id, d, { "Favorite color": "Blue" })).toBe("form_review");
    a = await app(id);
    expect(a.pendingQuestions).toEqual([]);
    expect(a.answers).toEqual({ "Favorite color": "Blue" });
  });

  it("never persists profile fields; a retry uses the corrected profile, not stale answers", async () => {
    await db.update(profiles).set({ website: "https://site.example" }).where(eq(profiles.userId, userId));
    const driver = new FakeDriver();
    const d = deps(driver);
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("form_review");
    let a = await app(id);
    expect(a.receipt?.fields.find((f) => f.label === "Github")?.value).toBe("https://site.example");
    expect(a.answers.Github).toBeUndefined();

    // Simulate a row written by the old runner: stale Github copied into answers, then a failure.
    await db.update(applications).set({ answers: { Github: "https://site.example", "Why Acme?": "My own words" }, status: "failed" }).where(eq(applications.id, id));
    await db.update(profiles).set({ preferences: { github: "https://github.com/jordan" } as Record<string, unknown> as typeof profiles.$inferInsert["preferences"] }).where(eq(profiles.userId, userId));

    expect(await retryApplication(db, id, d)).toBe("form_review");
    const last = driver.calls[driver.calls.length - 1];
    expect(last.answers.Github).toBeUndefined();
    expect(last.profile.github).toBe("https://github.com/jordan");
    expect(last.answers["Why Acme?"]).toBe("My own words"); // a real user answer survives
    a = await app(id);
    expect(a.answers).toEqual({ "Why Acme?": "My own words" });
    expect(a.receipt?.fields.find((f) => f.label === "Github")?.value).toBe("https://github.com/jordan");

    // approve-form with untouched values keeps answers user-only; a real edit is kept.
    expect(await approveForm(db, id, d, { Github: "https://github.com/jordan", "First Name": "Jo" })).toBe("submitted");
    a = await app(id);
    expect(a.answers).toEqual({ "Why Acme?": "My own words", "First Name": "Jo" });
  });

  it("resumeAutoApprove skips the resume gate", async () => {
    await db.update(profiles).set({ resumeAutoApprove: true }).where(eq(profiles.userId, userId));
    const driver = new FakeDriver();
    const { id } = await createApplication(db, userId, jobId);
    expect(await runApplication(db, id, deps(driver))).toBe("form_review");
    expect((await app(id)).resumeApprovedAt).toBeTruthy();
    expect(await steps(id)).not.toContain("approve_resume");
  });

  it("fails cleanly when the job has no driver", async () => {
    const { id } = await createApplication(db, userId, jobId);
    const d: RunnerDeps = { ...deps(new FakeDriver()), pickDriver: () => null };
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("failed");
    expect((await app(id)).error).toMatch(/No apply driver/);
  });

  it("autoApplyTick queues top matches up to the daily cap", async () => {
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, deps(new FakeDriver())); // computes the match row
    const [job2] = await db.insert(jobs).values({
      companyName: "Beta", atsType: "web", externalId: "beta-1", title: "Senior Frontend Engineer",
      descriptionText: JOB_TEXT, applyUrl: "https://example.com/jobs/2",
    }).returning();
    const { computeMatch } = await import("../match/score.js");
    const { retrieveEvidence } = await import("../graph/query.js");
    const { ensureRequirements } = await import("../feeds/requirements.js");
    await ensureRequirements(db, job2.id);
    await computeMatch(db, userId, job2.id, retrieveEvidence);

    expect((await autoApplyTick(db, userId)).created).toEqual([]); // cap 0 disables
    await db.update(profiles).set({ autoApplyDailyCap: 1, autoApplyMinScore: 0 }).where(eq(profiles.userId, userId));
    const first = await autoApplyTick(db, userId);
    expect(first.created).toHaveLength(1);
    expect((await autoApplyTick(db, userId)).created).toEqual([]); // cap reached
  });

  it("heuristic answers come from the profile only", () => {
    const profile = { fullName: "A B", firstName: "A", lastName: "B", email: "a@b.c", linkedin: "https://linkedin.com/in/ab", workAuth: { needsSponsorship: true } };
    const f = (label: string, options?: string[]) => ({ label, kind: "select" as const, required: true, options, selector: "" });
    expect(heuristicAnswer(f("Do you require visa sponsorship?", ["Yes, I will", "No"]), profile)).toBe("Yes, I will");
    expect(heuristicAnswer(f("LinkedIn URL"), profile)).toBe("https://linkedin.com/in/ab");
    expect(heuristicAnswer(f("Are you authorized to work in the US?"), profile)).toBeNull();
    expect(heuristicAnswer(f("Why us?"), profile)).toBeNull();
  });
});

/** Fills like the generic driver: ctx.answers by label, then ctx.answerQuestion; required blanks become pending. */
class AskingDriver implements ApplyDriver {
  atsType = "web" as const;
  calls: DriverContext[] = [];
  constructor(public fields: FormField[]) {}
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    this.calls.push(ctx);
    const filled: { label: string; value: string; kind: string }[] = [];
    const pending: { label: string; type: string; required: boolean }[] = [];
    for (const f of this.fields) {
      const value = ctx.answers[f.label] || (await ctx.answerQuestion(f, "Acme builds checkout software for online stores."));
      if (value) filled.push({ label: f.label, value, kind: f.kind });
      else if (f.required) pending.push({ label: f.label, type: f.kind, required: true });
    }
    const receipt = { fields: filled, files: [ctx.resumePdfPath], submittedVia: "fake", dryRun: ctx.dryRun, durationMs: 1 };
    if (pending.length) return { outcome: "needs_user", pending, receipt };
    if (ctx.dryRun) return { outcome: "filled", receipt, fields: this.fields };
    return { outcome: "submitted", receipt: { ...receipt, confirmationText: "Thanks" } };
  }
}

describe("runner free-text composer", () => {
  const ta = (label: string, required = true): FormField => ({ label, kind: "textarea", required, selector: "#q" });
  const WHY = "Why do you want to work here?";
  const PROJECT = "Tell us about a project you're proud of.";

  it("answers open questions itself: they land in autoAnswers with sources, not in pendingQuestions", async () => {
    const driver = new AskingDriver([ta(WHY), ta(PROJECT), ta("Anything else we should know?", false)]);
    const d = deps(driver);
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("form_review");
    const a = await app(id);
    expect(a.pendingQuestions).toEqual([]);
    const auto = autoAnswersOf(a);
    for (const q of [WHY, PROJECT]) {
      expect(auto[q], q).toBeTruthy();
      expect(lint(auto[q]), `${q}: ${auto[q]}`).toEqual([]);
      expect(auto[q]).toMatch(/\d/); // grounded in a real metric from the graph
    }
    expect(auto[WHY]).toMatch(/Acme/);
    if (process.env.SHOW_COMPOSED) console.log(JSON.stringify({ why: auto[WHY], project: auto[PROJECT], likely: auto["Why are you interested in this role?"] }, null, 2));
    expect(auto["Anything else we should know?"]).toBeUndefined(); // optional: left blank
    const sources = autoAnswerSourcesOf(a);
    expect(sources[WHY]?.length).toBeGreaterThan(0);
    expect(sources[PROJECT]?.length).toBeGreaterThan(0);
    expect(await steps(id)).toContain("compose");

    // Submitting re-uses exactly the reviewed text.
    expect(await approveForm(db, id, d)).toBe("submitted");
    expect(driver.calls[driver.calls.length - 1].answers[WHY]).toBe(auto[WHY]);
    expect(autoAnswerSourcesOf(await app(id))[WHY]).toEqual(sources[WHY]);
  });

  it("only legal identifiers and references go to the user", async () => {
    const driver = new AskingDriver([ta(WHY), { label: "Social Security Number", kind: "text", required: true, selector: "#ssn" }, ta("Please list two professional references")]);
    const d = deps(driver);
    const { id } = await createApplication(db, userId, jobId);
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("needs_user");
    const a = await app(id);
    expect(a.pendingQuestions.map((p) => p.label)).toEqual(["Social Security Number", "Please list two professional references"]);
    expect(autoAnswersOf(a)[WHY]).toBeTruthy();
  });

  it("researches the company before filling, bounded, and uses it in the answer", async () => {
    let calls = 0;
    const research = async () => {
      calls++;
      return { summary: "Acme makes a checkout API used by small online stores.", citations: [{ field: "summary", url: "https://acme.example/about" }] };
    };
    const driver = new AskingDriver([ta(WHY)]);
    const { id } = await createApplication(db, userId, jobId);
    const d = { ...deps(driver), research };
    await runApplication(db, id, d);
    expect(await approveResume(db, id, d)).toBe("form_review");
    expect(calls).toBe(1);
    const a = await app(id);
    expect(autoAnswersOf(a)[WHY]).toMatch(/checkout API/);
    expect(autoAnswerSourcesOf(a)[WHY]).toContain("https://acme.example/about");

    // A hung research call is cut off and the fill continues without it.
    const slow = { ...deps(new AskingDriver([ta(WHY)])), research: () => new Promise<never>(() => {}), researchTimeoutMs: 50 };
    const [job2] = await db.insert(jobs).values({
      companyName: "Beta", atsType: "web", externalId: "beta-1", title: "Senior Frontend Engineer",
      descriptionText: JOB_TEXT, applyUrl: "https://example.com/jobs/2",
    }).returning();
    const second = await createApplication(db, userId, job2.id);
    await runApplication(db, second.id, slow);
    expect(await approveResume(db, second.id, slow)).toBe("form_review");
    expect(autoAnswersOf(await app(second.id))[WHY]).toBeTruthy();
    const ev = await db.select().from(runEvents).where(eq(runEvents.applicationId, second.id));
    expect(ev.some((e) => e.step === "research" && /timed out/.test(e.message))).toBe(true);
  });
});
