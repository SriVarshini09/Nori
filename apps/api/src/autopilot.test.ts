import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  jobs, openTestDb, renderHtml, atsChecks,
  type ApplyDriver, type DriverContext, type DriverResult, type Db, type RenderFn, type AtsType,
} from "@jobgraph/core";
import { createApp } from "./app.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com | (415) 555-0199 | linkedin.com/in/jordanrivera

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments

Software Engineer | Brightside Analytics | Mar 2019 - Dec 2021
• Developed a Python and Airflow ETL pipeline ingesting 2M events per day

EDUCATION
B.S. in Computer Science, University of Washington
2013 - 2017

SKILLS
Languages: Python, TypeScript, JavaScript, SQL
`;

/** A form-filling driver we can steer: which platform it claims to be, and whether the form asks a free-text question. */
const knobs = { atsType: "greenhouse" as AtsType, askWhy: false };

class SteerableDriver implements ApplyDriver {
  get atsType() { return knobs.atsType; }
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    const fields = [{ label: "First Name", value: ctx.profile.firstName, kind: "text" }];
    if (knobs.askWhy) {
      const why = await ctx.answerQuestion({ label: "Why are you interested in this role?", kind: "textarea", required: true, selector: "#why" }, "");
      if (why) fields.push({ label: "Why are you interested in this role?", value: why, kind: "textarea" });
    }
    const receipt = { fields, files: [ctx.resumePdfPath], screenshotPath: path.join(ctx.artifactsDir, "filled.png"), submittedVia: "stub", dryRun: ctx.dryRun, durationMs: 1 };
    await mkdir(ctx.artifactsDir, { recursive: true });
    await writeFile(receipt.screenshotPath, "png");
    return ctx.dryRun ? { outcome: "filled", receipt, fields: [] } : { outcome: "submitted", receipt: { ...receipt, confirmationText: "Thanks" } };
  }
}

const stubRender: RenderFn = async (content, outPath, opts) => {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, "%PDF-1.4 stub");
  const html = renderHtml(content);
  const ats = atsChecks(content, html, opts.requirements ?? undefined, 1);
  return { html, pdfPath: outPath, pages: 1, atsScore: ats.score, atsChecks: ats.checks };
};

let db: Db;
let open: ReturnType<typeof createApp>; // submit lock open
let locked: ReturnType<typeof createApp>; // submit lock closed
let n = 0;

async function call(app: ReturnType<typeof createApp>, method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function newJob(company: string, title = "Senior Frontend Engineer", extra = "") {
  const [job] = await db.insert(jobs).values({
    companyName: company, atsType: "web", externalId: `ap-${++n}`, title, location: "San Francisco, CA", remote: true,
    descriptionText: `Requirements:\n- React and TypeScript\n- Node.js\n${extra}`, applyUrl: `https://example.com/jobs/${n}`,
  }).returning();
  return job.id;
}

/** Create the application (resume auto-approved) and read it back with its timeline. */
async function apply(jobId: string, app = open) {
  const created = await call(app, "POST", "/api/applications?wait=1", { jobId });
  expect(created.status).toBe(201);
  const d = (await call(app, "GET", `/api/applications/${created.json.id}`)).json;
  const autopilot = (d.events as { step: string; message: string }[]).find((e) => e.step === "autopilot");
  return { id: created.json.id as string, status: d.application.status as string, byAutopilot: d.application.autopilot as boolean, note: autopilot?.message ?? null };
}

beforeAll(async () => {
  db = await openTestDb();
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "jobgraph-autopilot-"));
  const base = { pickDriver: () => new SteerableDriver(), render: stubRender, artifactsRoot, autopilotMinApprovals: 2 };
  open = createApp(db, { runnerDeps: { ...base, allowRealSubmit: true }, mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
  locked = createApp(db, { runnerDeps: { ...base, allowRealSubmit: false }, mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
  expect((await call(open, "POST", "/api/profile/resume", { text: RESUME })).status).toBe(200);
  expect((await call(open, "PUT", "/api/profile", {
    settings: { resumeAutoApprove: true, autoApplyMinScore: 0.05, autopilot: "safe" },
    workAuth: { authorizedUS: true, needsSponsorship: false, status: "citizen" },
  })).status).toBe(200);
}, 120_000);

describe("Autopilot through the real runner", () => {
  it("turning it on turns review back on, and it shows in the agent status with the trust progress", async () => {
    await call(open, "PUT", "/api/profile", { settings: { reviewBeforeSubmit: false } });
    expect((await call(open, "GET", "/api/me")).json.profile.reviewBeforeSubmit).toBe(false);
    await call(open, "PUT", "/api/profile", { settings: { autopilot: "safe" } });
    const me = (await call(open, "GET", "/api/me")).json.profile;
    expect(me).toMatchObject({ autopilot: "safe", reviewBeforeSubmit: true });
    const status = (await call(open, "GET", "/api/agent/status")).json;
    expect(status).toMatchObject({ autopilot: "safe", autopilotTrust: { approved: 0 } });
    expect((await call(open, "PUT", "/api/profile", { settings: { autopilot: "sometimes" } })).status).toBe(400);
    await call(open, "GET", "/api/jobs?limit=50&wait=1"); // score what exists
  });

  it("waits for the person at first, and counts only hand-approved applications toward trust", async () => {
    for (const company of ["Acme", "Beta"]) {
      const a = await apply(await newJob(company));
      expect(a.status, company).toBe("form_review");
      expect(a.byAutopilot).toBe(false);
      expect(a.note).toMatch(/^Autopilot held this for your review:.*approve 2 applications yourself/);
      const sent = await call(open, "POST", `/api/applications/${a.id}/approve-form?wait=1`, {});
      expect(sent.json.status).toBe("submitted");
      expect(sent.json.autopilot).toBe(false);
    }
    expect((await call(open, "GET", "/api/agent/status")).json.autopilotTrust.approved).toBe(2);
  });

  it("then approves and sends by itself when every check passes, and leaves a record of why", async () => {
    const jobId = await newJob("Gamma");
    expect((await call(open, "GET", "/api/jobs?limit=50&wait=1")).status).toBe(200);
    const a = await apply(jobId);
    expect(a.note, "all checks should pass").toBe("Autopilot approved this form: all 11 checks passed");
    expect(a.status).toBe("submitted");
    expect(a.byAutopilot).toBe(true);
    const d = (await call(open, "GET", `/api/applications/${a.id}`)).json;
    const verdict = d.events.find((e: { step: string }) => e.step === "autopilot");
    expect(verdict.data.checks).toHaveLength(11);
    expect(verdict.data.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    // Autopilot's own sends do not raise the trust count: only the person's approvals do.
    expect((await call(open, "GET", "/api/agent/status")).json.autopilotTrust.approved).toBe(2);
  });

  it("holds a job that asks for a clearance the person does not have", async () => {
    const a = await apply(await newJob("Delta", "Senior Frontend Engineer", "Must hold an active secret clearance."));
    expect(a.status).toBe("form_review");
    expect(a.note).toMatch(/Autopilot held this for your review:.*security clearance/i);
  });

  it("holds a second application to a company applied to in the last 30 days", async () => {
    const a = await apply(await newJob("Gamma", "Staff Frontend Engineer"));
    expect(a.status).toBe("form_review");
    expect(a.note).toMatch(/already applied to this company/);
  });

  it("holds when the form is on a platform that needs an account", async () => {
    knobs.atsType = "workday";
    try {
      const a = await apply(await newJob("Epsilon"));
      expect(a.status).toBe("form_review");
      expect(a.note).toMatch(/workday is not on the list/);
    } finally { knobs.atsType = "greenhouse"; }
  });

  it("holds when Nori had to write a free-text answer, and sends once the person allows written answers", async () => {
    knobs.askWhy = true;
    try {
      const held = await apply(await newJob("Zeta"));
      expect(held.status).toBe("form_review");
      expect(held.note).toMatch(/Nori wrote 1 free-text answer/);

      await call(open, "PUT", "/api/profile", { settings: { autopilot: "written" } });
      const sent = await apply(await newJob("Eta"));
      expect(sent.note).toBe("Autopilot approved this form: all 11 checks passed");
      expect(sent.status).toBe("submitted");
      expect(sent.byAutopilot).toBe(true);
    } finally { knobs.askWhy = false; await call(open, "PUT", "/api/profile", { settings: { autopilot: "safe" } }); }
  });

  it("holds when the server's submit lock is closed, so nothing is promised that cannot happen", async () => {
    const a = await apply(await newJob("Theta"), locked);
    expect(a.status).toBe("form_review");
    expect(a.note).toMatch(/ALLOW_REAL_SUBMIT/);
  });

  it("does nothing at all when Autopilot is off", async () => {
    await call(open, "PUT", "/api/profile", { settings: { autopilot: "off" } });
    const a = await apply(await newJob("Iota"));
    expect(a.status).toBe("form_review");
    expect(a.note).toBeNull(); // no Autopilot entry on the timeline
    await call(open, "PUT", "/api/profile", { settings: { autopilot: "safe" } });
  });
});
