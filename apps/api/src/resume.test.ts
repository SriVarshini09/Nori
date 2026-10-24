import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSharedBrowser, jobs, openTestDb, SAMPLE_RESUME, type Db } from "@jobgraph/core";
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

let db: Db;
let app: ReturnType<typeof createApp>;
let jobId: string;

type Opts = { cookie?: string; body?: unknown; form?: FormData };
async function req(method: string, url: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(url, { method, headers, body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)) });
  const ct = res.headers.get("content-type") ?? "";
  let json: any = null;
  let buf: Buffer | null = null;
  if (ct.includes("json")) json = await res.json();
  else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buf, res };
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

async function signup(email: string) {
  const s = await req("POST", "/api/auth/signup", { body: { email, password: "correct-horse-1", name: "Jordan Rivera" } });
  expect(s.status).toBe(201);
  return cookieOf(s.res);
}

let A: string, B: string;

beforeAll(async () => {
  db = await openTestDb();
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "nori-resume-api-"));
  app = createApp(db, { runnerDeps: { pickDriver: () => null, artifactsRoot }, mcp: false, defaultUserEmail: null, rateLimit: false });
  const [job] = await db.insert(jobs).values({
    companyName: "Acme", atsType: "web", externalId: "acme-1", title: "Senior Frontend Engineer",
    descriptionText: "Requirements:\n- React and TypeScript\n- Node.js and PostgreSQL\nNice to have:\n- GraphQL", applyUrl: "https://example.com/?job=1",
  }).returning();
  jobId = job.id;
  A = await signup("a@example.com");
  B = await signup("b@example.com");
}, 60_000);

afterAll(async () => { await closeSharedBrowser(); });

describe("auth", () => {
  it("requires a session for the library and exports, but not for fonts", async () => {
    expect((await req("GET", "/api/resume-docs")).status).toBe(401);
    expect((await req("GET", "/api/resume-templates")).status).toBe(401);
    expect((await req("POST", "/api/resume/preview", { body: {} })).status).toBe(401);
    const font = await req("GET", "/api/resume-fonts/inter-latin-400-normal.woff2");
    expect(font.status).toBe(200);
    expect(font.res.headers.get("content-type")).toBe("font/woff2");
    expect(font.res.headers.get("cache-control")).toContain("immutable");
    expect(font.buf!.length).toBeGreaterThan(1000);
  });

  it("serves only registered font files", async () => {
    for (const bad of ["..%2Fapp.ts", "inter.woff2", "x-latin-400-normal.woff2", "%2e%2e%2f%2e%2e%2fpackage.json"]) {
      expect((await req("GET", `/api/resume-fonts/${bad}`)).status, bad).toBe(404);
    }
  });
});

describe("templates", () => {
  it("lists eight templates with fonts and page sizes, ATS Standard first", async () => {
    const r = await req("GET", "/api/resume-templates", { cookie: A });
    expect(r.status).toBe(200);
    expect(r.json.templates.map((t: any) => t.id)).toEqual(["ats", "classic", "modern", "compact", "executive", "minimal", "technical", "sidebar"]);
    expect(r.json.templates.find((t: any) => t.id === "sidebar")).toMatchObject({ atsSafe: false, columns: 2 });
    expect(r.json.templates[0].theme).toMatchObject({ font: "tinos", pageSize: "letter", headerAlign: "center" });
    expect(r.json.fonts.map((f: any) => f.id)).toContain("garamond");
    expect(r.json.pageSizes).toEqual([{ id: "letter", label: "US Letter" }, { id: "a4", label: "A4" }]);
  });

  it("renders a sample preview for a thumbnail, with theme overrides from the query", async () => {
    const r = await req("GET", "/api/resume-templates/executive/preview?accent=%23aa0000&pageSize=a4", { cookie: A });
    expect(r.status).toBe(200);
    const html = r.buf!.toString();
    expect(html).toContain("Alex Morgan");
    expect(html).toContain("#aa0000");
    expect(html).toContain("size: A4");
    expect(html).toContain("/api/resume-fonts/");
    expect((await req("GET", "/api/resume-templates/wordart/preview", { cookie: A })).status).toBe(404);
  });
});

describe("live preview", () => {
  it("returns html, the real page count and the ATS report", async () => {
    const r = await req("POST", "/api/resume/preview", { cookie: A, body: { content: SAMPLE_RESUME, templateId: "modern", theme: { accent: "#0a7d5a" } } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ pages: 1, targetPages: 1, templateId: "modern", density: "normal" });
    expect(r.json.html).toContain("#0a7d5a");
    expect(r.json.atsScore).toBeGreaterThan(80);
    expect(r.json.atsChecks.length).toBeGreaterThan(5);
    expect(r.json.theme).toMatchObject({ accent: "#0a7d5a", font: "inter" });
  }, 60_000);

  it("falls back to Classic for an unknown template, rejects bad content and oversize bodies", async () => {
    const ok = await req("POST", "/api/resume/preview", { cookie: A, body: { content: SAMPLE_RESUME, templateId: "wordart" } });
    expect(ok.json.templateId).toBe("classic");
    const bad = await req("POST", "/api/resume/preview", { cookie: A, body: { content: { name: 5 } } });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toMatch(/name/);
    const big = await req("POST", "/api/resume/preview", { cookie: A, body: { content: { ...SAMPLE_RESUME, summary: "x".repeat(600_000) } } });
    expect(big.status).toBe(413);
  }, 60_000);
});

describe("resume library", () => {
  let docId: string;

  it("creates the first document when a resume is uploaded", async () => {
    expect((await req("GET", "/api/resume-docs", { cookie: A })).json).toEqual([]);
    const up = await req("POST", "/api/profile/resume", { cookie: A, body: { text: RESUME } });
    expect(up.status).toBe(200);
    const list = await req("GET", "/api/resume-docs", { cookie: A });
    expect(list.json).toHaveLength(1);
    expect(list.json[0]).toMatchObject({ name: "My resume", source: "graph", isDefault: true, version: 1, headline: "Jordan Rivera" });
    expect(list.json[0].content).toBeUndefined(); // list rows stay small
    expect(list.json[0].stats.roles).toBeGreaterThan(0);
    docId = list.json[0].id;
    const full = await req("GET", `/api/resume-docs/${docId}`, { cookie: A });
    expect(full.json.content.experience[0].bullets.length).toBeGreaterThan(0);
  });

  it("edits with validation, version checks and conflict protection", async () => {
    const doc = (await req("GET", `/api/resume-docs/${docId}`, { cookie: A })).json;
    const content = structuredClone(doc.content);
    content.summary = "Full-stack engineer who ships.";
    content.experience[0].bullets[0].text = "Led the checkout migration to React and TypeScript, cutting load time 45% for two million users";
    const saved = await req("PUT", `/api/resume-docs/${docId}`, { cookie: A, body: { content, templateId: "modern", theme: { accent: "#7c3aed" }, expectedVersion: 1 } });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ version: 2, templateId: "modern" });
    expect(saved.json.theme.accent).toBe("#7c3aed");
    const stale = await req("PUT", `/api/resume-docs/${docId}`, { cookie: A, body: { name: "Stale", expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatch(/another tab/i);
    expect((await req("PUT", `/api/resume-docs/${docId}`, { cookie: A, body: { content: { name: 1 } } })).status).toBe(422);
    expect((await req("PUT", `/api/resume-docs/${docId}`, { cookie: A, body: { templateId: "wordart" } })).status).toBe(400);
    expect((await req("PUT", `/api/resume-docs/${docId}`, { cookie: A, body: { theme: { accent: "red" } } })).status).toBe(200); // invalid values clamp to the template look
  });

  it("keeps history and restores it", async () => {
    const versions = await req("GET", `/api/resume-docs/${docId}/versions`, { cookie: A });
    expect(versions.status).toBe(200);
    expect(versions.json.length).toBeGreaterThanOrEqual(2);
    expect(versions.json[0].content).toBeUndefined();
    const back = await req("POST", `/api/resume-docs/${docId}/versions/1/restore`, { cookie: A });
    expect(back.status).toBe(200);
    expect(back.json.templateId).toBe("ats");
    expect(back.json.content.summary).toBeUndefined();
    expect((await req("POST", `/api/resume-docs/${docId}/versions/abc/restore`, { cookie: A })).status).toBe(400);
    expect((await req("POST", `/api/resume-docs/${docId}/versions/999/restore`, { cookie: A })).status).toBe(404);
  });

  it("creates from content, blank, copy and graph; manages the default; deletes", async () => {
    const fromContent = await req("POST", "/api/resume-docs", { cookie: A, body: { from: "content", name: "Imported", content: SAMPLE_RESUME, templateId: "executive" } });
    expect(fromContent.status).toBe(201);
    expect(fromContent.json).toMatchObject({ name: "Imported", templateId: "executive", isDefault: false });
    const blank = await req("POST", "/api/resume-docs", { cookie: A, body: { from: "blank" } });
    expect(blank.json.content.name).toBe("Jordan Rivera");
    const copy = await req("POST", "/api/resume-docs", { cookie: A, body: { from: "copy", copyOf: docId } });
    expect(copy.json).toMatchObject({ name: "Copy of My resume", source: "copy" });
    const fromGraph = await req("POST", "/api/resume-docs", { cookie: A, body: { from: "graph", name: "From graph", templateId: "compact" } });
    expect(fromGraph.json).toMatchObject({ source: "graph", templateId: "compact" });
    expect((await req("POST", "/api/resume-docs", { cookie: A, body: { from: "copy" } })).status).toBe(400);
    expect((await req("POST", "/api/resume-docs", { cookie: A, body: { from: "content", content: { name: 3 } } })).status).toBe(422);

    const made = await req("POST", `/api/resume-docs/${fromContent.json.id}/default`, { cookie: A });
    expect(made.json.isDefault).toBe(true);
    const list = (await req("GET", "/api/resume-docs", { cookie: A })).json;
    expect(list.filter((d: any) => d.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(fromContent.json.id);

    const dup = await req("POST", `/api/resume-docs/${docId}/duplicate`, { cookie: A, body: { name: "Mine, again" } });
    expect(dup.status).toBe(201);
    expect(dup.json.name).toBe("Mine, again");
    expect((await req("DELETE", `/api/resume-docs/${dup.json.id}`, { cookie: A })).json).toEqual({ deleted: true });
    expect((await req("GET", `/api/resume-docs/${dup.json.id}`, { cookie: A })).status).toBe(404);
    const refreshed = await req("POST", `/api/resume-docs/${fromGraph.json.id}/refresh-from-graph`, { cookie: A });
    expect(refreshed.status).toBe(200);
  }, 60_000);

  it("exports every format with the right type, name and body", async () => {
    const dl = (format: string, extra = "") => req("GET", `/api/resume-docs/${docId}/download?format=${format}${extra}`, { cookie: A });
    const pdf = await dl("pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.res.headers.get("content-disposition")).toBe('attachment; filename="Jordan-Rivera-Resume.pdf"');
    expect(pdf.buf!.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await dl("pdf", "&inline=1")).res.headers.get("content-disposition")).toMatch(/^inline;/);

    const docx = await dl("docx");
    expect(docx.res.headers.get("content-type")).toContain("wordprocessingml");
    expect(docx.buf!.subarray(0, 2).toString()).toBe("PK");
    expect(docx.res.headers.get("content-disposition")).toMatch(/^attachment;.*\.docx/);

    const txt = await dl("txt");
    expect(txt.buf!.toString()).toContain("EXPERIENCE");
    expect(txt.res.headers.get("content-type")).toContain("text/plain");

    const json = await dl("json");
    expect(json.json).toMatchObject({ format: "nori-resume", content: { name: "Jordan Rivera" } });

    const html = await dl("html", "&inline=1");
    expect(html.buf!.toString()).toContain("<h1>Jordan Rivera</h1>");
    expect(html.res.headers.get("content-disposition")).toMatch(/^inline;/);

    expect((await dl("exe")).status).toBe(400);
    expect((await dl("pdf")).buf!.equals(pdf.buf!)).toBe(true); // cached render is identical
  }, 120_000);

  it("keeps each user's documents private", async () => {
    expect((await req("GET", "/api/resume-docs", { cookie: B })).json).toEqual([]);
    for (const [m, u] of [["GET", `/api/resume-docs/${docId}`], ["PUT", `/api/resume-docs/${docId}`], ["DELETE", `/api/resume-docs/${docId}`], ["POST", `/api/resume-docs/${docId}/default`], ["POST", `/api/resume-docs/${docId}/duplicate`], ["GET", `/api/resume-docs/${docId}/versions`], ["GET", `/api/resume-docs/${docId}/download?format=pdf`]] as const) {
      const r = await req(m, u, { cookie: B, body: m === "PUT" ? { name: "hijack" } : undefined });
      expect(r.status, `${m} ${u}`).toBe(404);
    }
    expect((await req("GET", `/api/resume-docs/${docId}`, { cookie: A })).json.name).not.toBe("hijack");
  });
});

describe("tailored resumes", () => {
  let appId: string;

  it("tailors with the default document's template and theme", async () => {
    await req("POST", "/api/resume-docs", { cookie: A, body: { from: "content", name: "Style source", content: { ...SAMPLE_RESUME, name: "Jordan Rivera", contact: { email: "jordan.rivera@example.com", phone: "(415) 555-0199" } }, templateId: "technical", theme: { accent: "#0f766e" }, makeDefault: true } });
    const created = await req("POST", "/api/applications?wait=1", { cookie: A, body: { jobId } });
    expect(created.status).toBe(201);
    appId = created.json.id;
    const detail = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    expect(detail.application.status).toBe("resume_review");
    expect(detail.resume).toMatchObject({ templateId: "technical", edited: false, version: 1 });
    expect(detail.resume.theme.accent).toBe("#0f766e");
    expect(detail.resume.html).toContain("#0f766e");
  }, 120_000);

  it("edits words, tracks the diff honestly and re-renders", async () => {
    const detail = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    const content = structuredClone(detail.resume.content);
    const first = content.experience[0].bullets[0];
    const originalText = first.text;
    first.text = "Cut checkout page load time by 45% for two million users by moving the flow to React and TypeScript";
    content.experience[0].bullets.push({ id: "mine-1", text: "Mentored four engineers through promotion to senior level", nodeIds: [] });
    const r = await req("PUT", `/api/applications/${appId}/resume`, { cookie: A, body: { content } });
    expect(r.status).toBe(200);
    expect(r.json.application).toMatchObject({ status: "resume_review", resumeApprovedAt: null });
    expect(r.json.resume).toMatchObject({ version: 2, edited: true, templateId: "technical" });
    expect(r.json.resume.html).toBeUndefined();
    const after = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    expect(after.application.resumeId).toBe(r.json.resume.id);
    const edit = after.resume.changes.find((c: any) => c.bulletId === first.id);
    expect(edit).toMatchObject({ reason: "Edited by you", after: first.text });
    expect(edit.before).not.toBe(first.text);
    const added = after.resume.changes.find((c: any) => c.bulletId === "mine-1");
    expect(added).toMatchObject({ reason: "Added by you", before: "", nodeIds: [] });
    expect(after.resume.content.experience[0].bullets.find((b: any) => b.id === "mine-1").edited).toBe(true);
    expect(after.events.some((e: any) => e.step === "resume_edit")).toBe(true);

    // putting the first bullet back removes it from the diff
    const revert = structuredClone(after.resume.content);
    revert.experience[0].bullets[0].text = edit.before;
    const r2 = await req("PUT", `/api/applications/${appId}/resume`, { cookie: A, body: { content: revert } });
    expect(r2.json.resume.version).toBe(3);
    const after2 = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    expect(after2.resume.changes.find((c: any) => c.bulletId === first.id)).toBeUndefined();
    void originalText;
  }, 120_000);

  it("restyles without touching the words, and a no-op returns the same version", async () => {
    const before = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    const r = await req("PUT", `/api/applications/${appId}/resume`, { cookie: A, body: { templateId: "executive", theme: { pageSize: "a4" } } });
    expect(r.status).toBe(200);
    expect(r.json.resume).toMatchObject({ templateId: "executive", version: before.resume.version + 1 });
    expect(r.json.resume.theme).toMatchObject({ pageSize: "a4", font: "garamond" });
    const same = await req("PUT", `/api/applications/${appId}/resume`, { cookie: A, body: { templateId: "executive" } });
    expect(same.json.resume.version).toBe(r.json.resume.version);
  }, 120_000);

  it("downloads the tailored resume in every format", async () => {
    const detail = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    const id = detail.resume.id;
    const pdf = await req("GET", `/api/resumes/${id}/download?format=pdf`, { cookie: A });
    expect(pdf.buf!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.res.headers.get("content-disposition")).toMatch(/Jordan-Rivera-Resume-v4\.pdf|Jordan-Rivera-Resume-v\d+\.pdf/);
    expect((await req("GET", `/api/resumes/${id}/download?format=docx`, { cookie: A })).buf!.subarray(0, 2).toString()).toBe("PK");
    expect((await req("GET", `/api/resumes/${id}/download?format=txt`, { cookie: A })).buf!.toString()).toContain("EXPERIENCE");
    expect((await req("GET", `/api/resumes/${id}/download?format=json`, { cookie: A })).json.format).toBe("nori-resume");
    expect((await req("GET", `/api/resumes/${id}/download?format=html`, { cookie: A })).buf!.toString()).toContain("<h1>");
    expect((await req("GET", `/api/resumes/${id}/download?format=pdf`, { cookie: B })).status).toBe(404);
  }, 120_000);

  it("protects other users' applications and files", async () => {
    expect((await req("PUT", `/api/applications/${appId}/resume`, { cookie: B, body: { templateId: "modern" } })).status).toBe(404);
    expect((await req("PUT", "/api/applications/not-a-uuid/resume", { cookie: A, body: { templateId: "modern" } })).status).toBe(404);
    const detail = (await req("GET", `/api/applications/${appId}`, { cookie: A })).json;
    const rel = detail.resume.pdfPath.replace(/\\/g, "/").replace(/^.*\/(?=[0-9a-f-]{36}\/)/, "");
    expect((await req("GET", `/api/artifacts/${rel}`, { cookie: A })).status).toBe(200);
    expect((await req("GET", `/api/artifacts/${rel}`, { cookie: B })).status).toBe(404);
    expect((await req("GET", `/api/artifacts/../../etc/passwd`, { cookie: A })).status).toBe(404);
  });

  it("only allows edits while the resume waits for review", async () => {
    await req("POST", `/api/applications/${appId}/approve-resume?wait=1`, { cookie: A });
    const r = await req("PUT", `/api/applications/${appId}/resume`, { cookie: A, body: { templateId: "modern" } });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/before the form is filled/);
  }, 120_000);
});
