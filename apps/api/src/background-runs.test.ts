import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobs, openTestDb, renderHtml, atsChecks, type ApplyDriver, type DriverContext, type DriverResult, type RenderFn } from "@jobgraph/core";
import { createApp } from "./app.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com | (415) 555-0199

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%

EDUCATION
B.S. in Computer Science, University of Washington
2013 - 2017
`;
class D implements ApplyDriver {
  atsType = "web" as const; supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    const receipt = { fields: [{ label: "First Name", value: ctx.profile.firstName, kind: "text" }], files: [ctx.resumePdfPath], screenshotPath: path.join(ctx.artifactsDir, "f.png"), submittedVia: "stub", dryRun: ctx.dryRun, durationMs: 1 };
    await mkdir(ctx.artifactsDir, { recursive: true }); await writeFile(receipt.screenshotPath, "png");
    return ctx.dryRun ? { outcome: "filled", receipt, fields: [] } : { outcome: "submitted", receipt: { ...receipt, confirmationText: "Thanks" } };
  }
}
const render: RenderFn = async (content, out, opts) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "%PDF-1.4"); const html = renderHtml(content); const a = atsChecks(content, html, opts.requirements ?? undefined, 1); return { html, pdfPath: out, pages: 1, atsScore: a.score, atsChecks: a.checks }; };

const Q = "Will you require visa sponsorship?";
class Asking implements ApplyDriver {
  atsType = "web" as const; supports() { return true; }
  async run(ctx: DriverContext): Promise<DriverResult> {
    await mkdir(ctx.artifactsDir, { recursive: true });
    const shot = path.join(ctx.artifactsDir, "f.png"); await writeFile(shot, "png");
    const base = { fields: [{ label: "First Name", value: "Jo", kind: "text" }], files: [ctx.resumePdfPath], screenshotPath: shot, submittedVia: "stub", dryRun: ctx.dryRun, durationMs: 1 };
    if (!ctx.answers[Q]) return { outcome: "needs_user", pending: [{ label: Q, type: "select", required: true }], receipt: base };
    return ctx.dryRun ? { outcome: "filled", receipt: base, fields: [] } : { outcome: "submitted", receipt: { ...base, confirmationText: "Thanks" } };
  }
}

describe("answering a question, then approving at once (what the browser does)", () => {
  it("the answer is saved and the application already moving when /answer replies, so the next request is never refused", async () => {
    const db = await openTestDb();
    const root = await mkdtemp(path.join(os.tmpdir(), "ans-"));
    const app = createApp(db, { runnerDeps: { pickDriver: () => new Asking(), render, artifactsRoot: root, allowRealSubmit: true }, mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
    const call = async (m: string, u: string, b?: unknown) => { const r = await app.request(u, { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, j: t }; } };
    await call("POST", "/api/profile/resume", { text: RESUME });
    await call("PUT", "/api/profile", { settings: { resumeAutoApprove: true } });
    const [job] = await db.insert(jobs).values({ companyName: "Acme", atsType: "web", externalId: "ans-1", title: "Engineer", descriptionText: "Requirements:\n- React", applyUrl: "https://example.com/1" }).returning();
    const id = (await call("POST", "/api/applications?wait=1", { jobId: job.id })).j.id as string;
    expect((await call("GET", `/api/applications/${id}`)).j.application).toMatchObject({ status: "needs_user", pendingQuestions: [{ label: Q }] });

    const answered = await call("POST", `/api/applications/${id}/answer`, { answers: { [Q]: "No" } }); // no ?wait
    expect(answered.s).toBe(200);
    expect(answered.j.answers[Q]).toBe("No");
    expect(answered.j.pendingQuestions).toEqual([]);
    expect(answered.j.status).not.toBe("needs_user");

    const approved = await call("POST", `/api/applications/${id}/approve-form`, {}); // straight after, no waiting
    expect(approved.s).toBe(200);
    const end = Date.now() + 20_000;
    let status = "";
    while (Date.now() < end && status !== "submitted") { status = (await call("GET", `/api/applications/${id}`)).j.application.status; await new Promise((r) => setTimeout(r, 100)); }
    expect(status).toBe("submitted");
  }, 90_000);
});

describe("background runs (no ?wait)", () => {
  it("move an application from created to submitted on their own", async () => {
    const db = await openTestDb();
    const root = await mkdtemp(path.join(os.tmpdir(), "bg-"));
    const app = createApp(db, { runnerDeps: { pickDriver: () => new D(), render, artifactsRoot: root, allowRealSubmit: true }, mcp: false, rateLimit: false, defaultUserEmail: "me@example.com" });
    const call = async (m: string, u: string, b?: unknown) => { const r = await app.request(u, { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, j: t }; } };
    await call("POST", "/api/profile/resume", { text: RESUME });
    const [job] = await db.insert(jobs).values({ companyName: "Acme", atsType: "web", externalId: "bg-1", title: "Engineer", descriptionText: "Requirements:\n- React", applyUrl: "https://example.com/1" }).returning();
    const until = async (id: string, want: RegExp, label: string) => {
      const end = Date.now() + 20_000; let st = "";
      while (Date.now() < end) { st = (await call("GET", `/api/applications/${id}`)).j.application.status; if (want.test(st)) return st; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`${label}: stuck at ${st}`);
    };
    const created = await call("POST", "/api/applications", { jobId: job.id });
    const id = created.j.id as string;
    expect(await until(id, /^resume_review$/, "after create")).toBe("resume_review");
    await call("POST", `/api/applications/${id}/approve-resume`);
    expect(await until(id, /^form_review$/, "after approve-resume")).toBe("form_review");
    await call("POST", `/api/applications/${id}/approve-form`, {});
    expect(await until(id, /^submitted$/, "after approve-form")).toBe("submitted");
  }, 90_000);
});
