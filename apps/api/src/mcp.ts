/**
 * MCP server over streamable HTTP at POST /mcp (stateless: one server + transport per request, JSON
 * responses). Tools: find_jobs, research_company, tailor_resume, apply, status, add_fact, skill_gaps.
 *
 * NO AUTH: this endpoint acts as the single default user and is meant for localhost only. Do not expose
 * the API port publicly until auth lands.
 */
import type { Env, Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  applications, jobs, resumes,
  addFact, approveForm, approveResume, createApplication, ensureRequirements, findAndRank, researchCompany,
  runApplication, skillGaps,
  type Application, type Db, type RunnerDeps,
} from "@jobgraph/core";

type Me = () => Promise<{ id: string }>;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

async function summarize(db: Db, app: Application) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [resume] = app.resumeId ? await db.select().from(resumes).where(eq(resumes.id, app.resumeId)).limit(1) : [];
  return {
    applicationId: app.id, status: app.status, job: job ? { id: job.id, title: job.title, company: job.companyName, applyUrl: job.applyUrl } : null,
    resume: resume ? { id: resume.id, version: resume.version, pdfPath: resume.pdfPath, atsScore: resume.atsScore, keywordCoverage: resume.keywordCoverage, changes: resume.changes } : null,
    answers: app.answers, pendingQuestions: app.pendingQuestions, error: app.error,
    receipt: app.receipt ? { dryRun: app.receipt.dryRun, confirmationText: app.receipt.confirmationText, screenshotPath: app.receipt.screenshotPath, fields: app.receipt.fields.length } : null,
    submittedAt: app.submittedAt,
  };
}

export function buildMcpServer(db: Db, deps: RunnerDeps, me: Me): McpServer {
  const server = new McpServer({ name: "jobgraph", version: "0.1.0" });
  const reload = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)).limit(1))[0];

  server.registerTool("find_jobs", {
    description: "Search for job postings (company ATS boards, X, Hacker News, Wellfound, Y Combinator, public LinkedIn job pages), store them, and return the best matches for the user's career graph. Takes about 20 seconds.",
    inputSchema: {
      objective: z.string().describe("Natural language, e.g. 'senior frontend roles at Series B startups, remote or SF'"),
      titles: z.array(z.string()).optional(), locations: z.array(z.string()).optional(), remote: z.boolean().optional(),
    },
  }, async ({ objective, titles, locations, remote }) => {
    try {
      const user = await me();
      // Callers such as Omnara give up on a tool after 30 s, so the search and the scoring share a 22 s budget.
      const res = await findAndRank(db, user.id, { objective, titles, locations, remote, maxResults: 10, budgetMs: 22_000 });
      return json({
        added: res.added,
        jobs: res.jobs.slice(0, 10).map((r) => ({
          jobId: r.job.id, title: r.job.title, company: r.job.companyName, location: r.job.location, remote: r.job.remote,
          score: r.match?.score ?? null, reasons: r.match?.explanation.reasons ?? [], applyUrl: r.job.applyUrl,
        })),
      });
    } catch (err) { return fail(`find_jobs failed: ${(err as Error).message}`); }
  });

  server.registerTool("research_company", {
    description: "Research a company (funding, stage, headcount, news, interview process, visa sponsorship) with citations.",
    inputSchema: { name: z.string() },
  }, async ({ name }) => {
    try { return json(await researchCompany(db, name)); } catch (err) { return fail(`research_company failed: ${(err as Error).message}`); }
  });

  server.registerTool("tailor_resume", {
    description: "Create an application for a job and run it to the resume review gate. Returns the bullet changes with provenance and the PDF path.",
    inputSchema: { jobId: z.string().uuid() },
  }, async ({ jobId }) => {
    try {
      const user = await me();
      const created = await createApplication(db, user.id, jobId);
      await runApplication(db, created.id, deps);
      return json(await summarize(db, await reload(created.id)));
    } catch (err) { return fail(`tailor_resume failed: ${(err as Error).message}`); }
  });

  server.registerTool("apply", {
    description: "Advance the application for a job. Without approve it runs to the next review gate; with approve=true it approves the current gate (resume, then form) and continues. Real submission still requires ALLOW_REAL_SUBMIT=true on the server.",
    inputSchema: { jobId: z.string().uuid(), approve: z.boolean().optional() },
  }, async ({ jobId, approve }) => {
    try {
      const user = await me();
      const app = await createApplication(db, user.id, jobId);
      if (approve && app.status === "resume_review") await approveResume(db, app.id, deps);
      else if (approve && app.status === "form_review") await approveForm(db, app.id, deps);
      else await runApplication(db, app.id, deps);
      return json(await summarize(db, await reload(app.id)));
    } catch (err) { return fail(`apply failed: ${(err as Error).message}`); }
  });

  server.registerTool("status", {
    description: "One application's details, or every application with its status when applicationId is omitted.",
    inputSchema: { applicationId: z.string().uuid().optional() },
  }, async ({ applicationId }) => {
    const user = await me();
    if (applicationId) {
      const [app] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, user.id))).limit(1);
      return app ? json(await summarize(db, app)) : fail("Application not found");
    }
    const rows = await db.select({ a: applications, j: jobs }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applications.userId, user.id)).orderBy(desc(applications.updatedAt));
    return json(rows.map(({ a, j }) => ({ applicationId: a.id, jobId: j.id, title: j.title, company: j.companyName, status: a.status, updatedAt: a.updatedAt })));
  });

  server.registerTool("add_fact", {
    description: "Add a career fact to the user's graph from one sentence, e.g. 'I led a migration that cut costs 30% at Acme'.",
    inputSchema: { text: z.string() },
  }, async ({ text }) => json(await addFact(db, (await me()).id, text)));

  server.registerTool("skill_gaps", {
    description: "Requirements of a job that the user's career graph has no evidence for.",
    inputSchema: { jobId: z.string().uuid() },
  }, async ({ jobId }) => {
    const req = await ensureRequirements(db, jobId);
    if (!req) return fail("Job not found");
    return json(await skillGaps(db, (await me()).id, req));
  });

  return server;
}

export function mountMcp<E extends Env>(app: Hono<E>, db: Db, deps: RunnerDeps, me: Me) {
  app.post("/mcp", async (c) => {
    // Outside local dev the endpoint is public: require `Authorization: Bearer $MCP_TOKEN`.
    const token = process.env.MCP_TOKEN;
    if (token || process.env.NODE_ENV === "production") {
      const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token || got !== token) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: set MCP_TOKEN and send it as a Bearer token" }, id: null }),
          { status: 401, headers: { "content-type": "application/json" } });
      }
    }
    const server = buildMcpServer(db, deps, me);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    }
  });
  const notAllowed = () => new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }),
    { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
