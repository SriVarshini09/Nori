import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  jobs, applications, openTestDb, users, renderHtml, atsChecks,
  type ApplyDriver, type DriverContext, type DriverResult, type Db, type RenderFn,
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

class StubDriver implements ApplyDriver {
  atsType = "web" as const;
  supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    const receipt = {
      fields: [{ label: "First Name", value: ctx.profile.firstName, kind: "text" }], files: [ctx.resumePdfPath],
      screenshotPath: path.join(ctx.artifactsDir, "filled.png"), submittedVia: "stub", dryRun: ctx.dryRun, durationMs: 1,
    };
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
let app: ReturnType<typeof createApp>;
let jobId: string;

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, res };
}

beforeAll(async () => {
  db = await openTestDb();
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "jobgraph-api-"));
  app = createApp(db, { runnerDeps: { pickDriver: () => new StubDriver(), render: stubRender, artifactsRoot, allowRealSubmit: true }, mcp: true, defaultUserEmail: "me@example.com" });
  const [job] = await db.insert(jobs).values({
    companyName: "Acme", atsType: "web", externalId: "acme-1", title: "Senior Frontend Engineer",
    descriptionText: "Requirements:\n- React and TypeScript\n- Node.js and PostgreSQL\nNice to have:\n- GraphQL",
    applyUrl: "https://example.com/jobs/1",
  }).returning();
  jobId = job.id;
});

describe("api", () => {
  it("health and me", async () => {
    expect((await call("GET", "/api/health")).json.ok).toBe(true);
    const me = await call("GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBeTruthy();
    expect(me.json.profile.userId).toBe(me.json.user.id);
    expect(me.json.profile.reviewBeforeSubmit).toBe(true);
  });

  it("ingests a resume and returns the graph", async () => {
    const r = await call("POST", "/api/profile/resume", { text: RESUME });
    expect(r.status).toBe(200);
    expect(r.json.nodesCreated).toBeGreaterThan(0);
    const g = await call("GET", "/api/graph");
    expect(Array.isArray(g.json.nodes)).toBe(true);
    expect(Array.isArray(g.json.edges)).toBe(true);
    expect(g.json.nodes[0]).toHaveProperty("type");
    const bad = await call("POST", "/api/profile/resume", { text: 5 });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/text/);
  });

  it("updates the profile", async () => {
    const r = await call("PUT", "/api/profile", { fullName: "Jordan Rivera", workAuth: { authorizedUS: true }, settings: { autoApplyDailyCap: 2 } });
    expect(r.json.profile.fullName).toBe("Jordan Rivera");
    expect(r.json.profile.autoApplyDailyCap).toBe(2);
    expect(r.json.profile.workAuth.authorizedUS).toBe(true);
  });

  it("keeps extra preference keys and merges preferences", async () => {
    await call("PUT", "/api/profile", { preferences: { country: "US", github: "https://github.com/jr", titles: ["Engineer"] } });
    const r = await call("PUT", "/api/profile", { preferences: { remote: "ok", customKey: "kept" } });
    expect(r.status).toBe(200);
    const me = await call("GET", "/api/me");
    expect(me.json.profile.preferences).toEqual({ country: "US", github: "https://github.com/jr", titles: ["Engineer"], remote: "ok", customKey: "kept" });
  });

  it("lists jobs as { job, match }", async () => {
    const detail = await call("GET", `/api/jobs/${jobId}`); // computes the match
    expect(detail.json.job.id).toBe(jobId);
    expect(detail.json.match.score).toBeGreaterThanOrEqual(0);
    const r = await call("GET", "/api/jobs?q=frontend&status=new");
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);
    expect(r.json[0].job.id).toBe(jobId);
    expect(r.json[0].match.explanation.reasons.length).toBeGreaterThan(0);
    expect((await call("GET", "/api/jobs?q=nomatch")).json).toEqual([]);
    expect((await call("GET", "/api/jobs?status=bogus")).status).toBe(400);
  });

  it("runs an application through both gates", async () => {
    const created = await call("POST", "/api/applications?wait=1", { jobId });
    expect(created.status).toBe(201);
    const id = created.json.id;
    expect(created.json.status).toBe("resume_review");

    let d = await call("GET", `/api/applications/${id}`);
    expect(Object.keys(d.json).sort()).toEqual(["application", "company", "events", "job", "match", "recruiter", "resume"]);
    expect(d.json.recruiter).toMatchObject({ verdict: expect.stringMatching(/strong|good|needs_work/), stats: { bullets: expect.any(Number) } });
    expect(d.json.recruiter.score).toBeGreaterThan(0);
    expect(d.json.resume.pdfPath).toMatch(/resume-v1\.pdf$/);
    expect(d.json.events[0]).toMatchObject({ applicationId: id, step: "created" });
    expect(typeof d.json.events[0].ts).toBe("string");

    const pdf = await app.request(`/api/resumes/${d.json.resume.id}.pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");

    expect((await call("POST", `/api/applications/${id}/approve-resume?wait=1`)).json.status).toBe("form_review");
    d = await call("GET", `/api/applications/${id}`);
    expect(d.json.application.receipt.screenshotPath).toBe(`${id}/filled.png`);
    const shot = await app.request(`/api/artifacts/${d.json.application.receipt.screenshotPath}`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect((await app.request("/api/artifacts/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);

    const approved = await call("POST", `/api/applications/${id}/approve-form?wait=1`, { answers: { "First Name": "Jo" } });
    expect(approved.json.status).toBe("submitted");
    expect(approved.json.answers["First Name"]).toBe("Jo");

    const list = await call("GET", "/api/applications?status=submitted");
    expect(list.json).toHaveLength(1);
    expect(list.json[0].application.id).toBe(id);
    expect(list.json[0].job.id).toBe(jobId);
    expect(list.json[0].resume.id).toBe(d.json.resume.id);

    expect((await call("GET", "/api/jobs?status=applied")).json).toHaveLength(1);
  });

  it("tracker stats", async () => {
    const r = await call("GET", "/api/tracker/stats");
    expect(r.json.byStatus).toEqual({ submitted: 1 });
    expect(r.json.thisWeek).toEqual({ applied: 1, replied: 0, interview: 0 });
  });

  it("returns JSON errors", async () => {
    const r = await call("GET", "/api/applications/00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "Application not found" });
    expect((await call("GET", "/api/nope")).json.error).toMatch(/No route/);
  });

  it("approve-form waits for a run that is still resuming after an answer instead of answering 409", async () => {
    const [job] = await db.insert(jobs).values({
      companyName: "Beta", atsType: "web", externalId: "beta-1", title: "Platform Engineer",
      descriptionText: "Requirements:\n- TypeScript", applyUrl: "https://example.com/jobs/2",
    }).returning();
    const created = await call("POST", "/api/applications?wait=1", { jobId: job.id });
    const id = created.json.id as string;
    expect((await call("POST", `/api/applications/${id}/approve-resume?wait=1`)).json.status).toBe("form_review");

    // The state a user hits right after answering: the run is back to filling and reaches the review a moment later.
    await db.update(applications).set({ status: "filling" }).where(eq(applications.id, id));
    setTimeout(() => { void Promise.resolve(db.update(applications).set({ status: "form_review" }).where(eq(applications.id, id))); }, 700); // drizzle builders run only when awaited
    const started = Date.now();
    const approved = await call("POST", `/api/applications/${id}/approve-form?wait=1`, { answers: { "First Name": "Jo" } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe("submitted");

    // A finished application still answers 409 at once.
    const again = await call("POST", `/api/applications/${id}/approve-form?wait=1`, {});
    expect(again.status).toBe(409);
  });

  it("answers 422 with the reason for a pasted link that is not a readable public job page", async () => {
    const internal = await call("POST", "/api/jobs/url", { url: "http://169.254.169.254/latest/meta-data/" });
    expect(internal.status).toBe(422);
    expect(internal.json.error).toMatch(/not a public website/);
    const board = await call("POST", "/api/jobs/url", { url: "https://boards.greenhouse.io/acme" });
    expect(board.status).toBe(422);
    expect(board.json.error).toMatch(/job board, not a single posting/);
    expect((await call("POST", "/api/jobs/url", { url: "nope" })).status).toBe(400);
  });

  it("serves MCP tools over streamable HTTP", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const j: any = await res.json();
    const names = j.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["add_fact", "apply", "find_jobs", "research_company", "skill_gaps", "status", "tailor_resume"]);
  });
});

describe("auth and onboarding", () => {
  let authApp: ReturnType<typeof createApp>;
  const req = async (method: string, url: string, opts: { body?: unknown; cookie?: string; form?: FormData } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await authApp.request(url, { method, headers, body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, res };
  };
  const cookieOf = (res: Response) => /jg_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

  beforeAll(() => {
    authApp = createApp(db, { mcp: false, defaultUserEmail: null });
  });

  it("requires a session when there is no fallback user", async () => {
    expect((await req("GET", "/api/me")).status).toBe(401);
    expect((await req("GET", "/api/auth/session")).status).toBe(401);
    expect((await req("GET", "/api/health")).status).toBe(200);
  });

  it("signs up, logs in, resolves the session and logs out", async () => {
    expect((await req("POST", "/api/auth/signup", { body: { email: "bad", password: "longenough" } })).status).toBe(400);
    expect((await req("POST", "/api/auth/signup", { body: { email: "a@b.co", password: "short" } })).status).toBe(400);
    const s = await req("POST", "/api/auth/signup", { body: { email: "Casey@Example.com", password: "s3cret-pass", name: "Casey Kim" } });
    expect(s.status).toBe(201);
    expect(s.json.user).toMatchObject({ email: "casey@example.com", name: "Casey Kim" });
    expect(s.json.user.passwordHash).toBeUndefined();
    const setCookie = s.res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/jg_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    expect((await req("POST", "/api/auth/signup", { body: { email: "casey@example.com", password: "s3cret-pass" } })).status).toBe(409);

    expect((await req("POST", "/api/auth/login", { body: { email: "casey@example.com", password: "wrong-pass" } })).status).toBe(401);
    expect((await req("POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "wrong-pass" } })).status).toBe(401);
    const l = await req("POST", "/api/auth/login", { body: { email: "casey@example.com", password: "s3cret-pass" } });
    expect(l.status).toBe(200);
    const cookie = cookieOf(l.res);
    const sess = await req("GET", "/api/auth/session", { cookie });
    expect(sess.json).toMatchObject({ user: { email: "casey@example.com" }, via: "session" });
    const me = await req("GET", "/api/me", { cookie });
    expect(me.json.profile.fullName).toBe("Casey Kim");
    expect(me.json.profile.onboarding.step).toBe("resume");

    const out = await req("POST", "/api/auth/logout", { cookie });
    expect(out.status).toBe(204);
    expect(out.res.headers.get("set-cookie")).toMatch(/jg_session=;/);
    expect((await req("GET", "/api/auth/session", { cookie })).status).toBe(401);
    expect((await req("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("scores jobs for a new account lazily and again after the resume lands", async () => {
    const s = await req("POST", "/api/auth/signup", { body: { email: "fresh@example.com", password: "s3cret-pass" } });
    const cookie = cookieOf(s.res);
    const before = await req("GET", "/api/jobs", { cookie });
    expect(before.json[0].match).not.toBeNull(); // computed on read, not left empty
    expect((await req("POST", "/api/profile/resume?wait=1", { cookie, body: { text: RESUME } })).status).toBe(200);
    const after = await req("GET", "/api/jobs", { cookie });
    expect(after.json[0].match.score).toBeGreaterThan(before.json[0].match.score);
    expect(new Date(after.json[0].match.computedAt).getTime()).toBeGreaterThan(new Date(before.json[0].match.computedAt).getTime());
  });

  it("walks the onboarding wizard and uploads a resume file", async () => {
    const s = await req("POST", "/api/auth/signup", { body: { email: "onboard@example.com", password: "s3cret-pass" } });
    const cookie = cookieOf(s.res);
    expect((await req("GET", "/api/onboarding", { cookie })).json.step).toBe("resume");

    const form = new FormData();
    form.append("file", new File([RESUME], "resume.txt", { type: "text/plain" }));
    const up = await req("POST", "/api/profile/resume-file", { cookie, form });
    expect(up.status).toBe(200);
    expect(up.json.nodesCreated).toBeGreaterThan(0);
    expect(up.json.extractedChars).toBeGreaterThan(100);
    const exe = new FormData();
    exe.append("file", new File(["MZ"], "x.exe", { type: "application/octet-stream" }));
    expect((await req("POST", "/api/profile/resume-file", { cookie, form: exe })).status).toBe(415);

    let r = await req("PUT", "/api/onboarding", { cookie, body: { step: "resume" } });
    expect(r.json.step).toBe("contact");
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "contact", data: { fullName: "On Board", city: "Austin", state: "TX", country: "US", github: "https://github.com/ob" } } });
    expect(r.status).toBe(200);
    expect(r.json.step).toBe("authorization");
    expect(r.json.profile).toMatchObject({ fullName: "On Board", city: "Austin", location: "Austin, TX, US", github: "https://github.com/ob" });
    expect((await req("PUT", "/api/onboarding", { cookie, body: { step: "authorization", data: { workAuth: { status: "martian" } } } })).status).toBe(400);
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "authorization", data: { workAuth: { authorizedUS: true, needsSponsorship: false, status: "citizen" }, willingToRelocate: false } } });
    expect(r.json.profile.workAuth).toEqual({ authorizedUS: true, needsSponsorship: false, status: "citizen" });
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "screening", data: { salaryExpectation: { amount: 150000, currency: "USD", period: "year" }, noticePeriodWeeks: 2, over18: true, eeo: { gender: "Female" } } } });
    expect(r.json.step).toBe("preferences");
    expect(r.json.profile.eeo).toEqual({ gender: "Female", race: "decline", veteran: "decline", disability: "decline" });
    // Editing an earlier step keeps progress.
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "contact", data: { phone: "555-0100" } } });
    expect(r.json.step).toBe("preferences");
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "preferences", data: { titles: ["Engineer"], remote: "ok", autoApplyDailyCap: 3 } } });
    expect(r.json.profile.preferences).toMatchObject({ titles: ["Engineer"], remote: "ok" });
    expect(r.json.profile.autoApplyDailyCap).toBe(3);
    r = await req("PUT", "/api/onboarding", { cookie, body: { step: "integrations" } });
    expect(r.json.step).toBe("done");
    expect(r.json.profile.onboarding.completedAt).toBeTruthy();
    const g = await req("GET", "/api/onboarding", { cookie });
    expect(g.json.step).toBe("done");

    const p = await req("PUT", "/api/profile", { cookie, body: { heardAbout: "LinkedIn", securityClearance: "None", pronouns: "she/her" } });
    expect(p.json.profile).toMatchObject({ heardAbout: "LinkedIn", securityClearance: "None", pronouns: "she/her" });
  });
  it("deletes an account only with the right email and a real session", async () => {
    const s = await req("POST", "/api/auth/signup", { body: { email: "bye@example.com", password: "s3cret-pass", name: "Bye" } });
    const cookie = cookieOf(s.res);
    await req("PUT", "/api/onboarding", { cookie, body: { step: "contact", data: { phone: "555-0100" } } });
    expect((await req("DELETE", "/api/auth/account", { body: { confirm: "bye@example.com" } })).status).toBe(401);
    expect((await req("DELETE", "/api/auth/account", { cookie, body: { confirm: "someone@else.com" } })).status).toBe(400);
    expect((await req("DELETE", "/api/auth/account", { cookie, body: {} })).status).toBe(400);
    expect((await req("GET", "/api/auth/session", { cookie })).status).toBe(200);

    const del = await req("DELETE", "/api/auth/account", { cookie, body: { confirm: " Bye@Example.com " } });
    expect(del.status).toBe(204);
    expect(del.res.headers.get("set-cookie")).toMatch(/jg_session=;/);
    expect((await req("GET", "/api/auth/session", { cookie })).status).toBe(401);
    expect((await req("POST", "/api/auth/login", { body: { email: "bye@example.com", password: "s3cret-pass" } })).status).toBe(401);
    expect(await db.select().from(users).where(eq(users.email, "bye@example.com"))).toHaveLength(0);
    // Signing up again with the same email works: nothing is left behind.
    expect((await req("POST", "/api/auth/signup", { body: { email: "bye@example.com", password: "s3cret-pass" } })).status).toBe(201);
  });

  it("refuses to delete the DEFAULT_USER_EMAIL fallback user", async () => {
    const fallbackApp = createApp(db, { mcp: false, defaultUserEmail: "demo-keep@example.com" });
    const r = await fallbackApp.request("/api/auth/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "demo-keep@example.com" }) });
    expect(r.status).toBe(403);
    expect((await fallbackApp.request("/api/me")).status).toBe(200);
  });

  it("production cookies are Secure; COOKIE_DOMAIN switches to SameSite=None with a Domain", async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, COOKIE_DOMAIN: process.env.COOKIE_DOMAIN };
    const signup = async (email: string) => {
      const a = createApp(db, { mcp: false, defaultUserEmail: null });
      const r = await a.request("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "s3cret-pass" }) });
      return r.headers.get("set-cookie") ?? "";
    };
    try {
      process.env.NODE_ENV = "production";
      delete process.env.COOKIE_DOMAIN;
      const proxied = await signup("prod-a@example.com");
      expect(proxied).toMatch(/Secure/i);
      expect(proxied).toMatch(/SameSite=Lax/i);
      expect(proxied).not.toMatch(/Domain=/i);
      process.env.COOKIE_DOMAIN = ".norinote.xyz";
      const shared = await signup("prod-b@example.com");
      expect(shared).toMatch(/Secure/i);
      expect(shared).toMatch(/SameSite=None/i);
      expect(shared).toMatch(/Domain=.?norinote.xyz/i);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
