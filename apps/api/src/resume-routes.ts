import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_TEMPLATE, FONTS, PAGE_SIZES, ResumeDocError, SAMPLE_RESUME, TEMPLATES, TEMPLATE_IDS, applications, createBlankResumeDoc, createResumeDoc, createResumeDocFromGraph,
  deleteResumeDoc, duplicateResumeDoc, editApplicationResume, getResumeDoc, isTemplateId, listResumeDocVersions, listResumeDocs, parseResumeContent,
  readFontFile, rebuildResumeDocFromGraph, renderResume, renderResumeDocx, renderResumeHtml, renderResumeJson, renderResumeText, resumeFileBase, resumes,
  restoreResumeDocVersion, setDefaultResumeDoc, themeFor, updateResumeDoc,
  type Db, type ResumeContent, type ResumeDoc, type RunnerDeps,
} from "@jobgraph/core";
import type { AppEnv } from "./app.js";
import { bad, body, uuidOk } from "./http.js";

const FORMATS = ["pdf", "docx", "txt", "json", "html"] as const;
type Format = (typeof FORMATS)[number];

/** Small in-memory cache of rendered downloads, keyed by document and version, so repeated clicks do not re-render. */
const CACHE_MAX = 24;
const cache = new Map<string, Buffer>();
function cached(key: string): Buffer | undefined {
  const v = cache.get(key);
  if (v) { cache.delete(key); cache.set(key, v); }
  return v;
}
function remember(key: string, v: Buffer) {
  cache.set(key, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

const MIME: Record<Format, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
};

function download(buf: Buffer | string, format: Format, name: string, inline: boolean): Response {
  const data = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": MIME[format],
      "content-length": String(data.length),
      "content-disposition": `${inline && (format === "pdf" || format === "html") ? "inline" : "attachment"}; filename="${name}.${format}"`,
      "cache-control": "private, no-cache",
    },
  });
}

const ContentIn = z.unknown();
const StyleIn = { templateId: z.string().max(40).optional(), theme: z.record(z.string(), z.unknown()).optional() };

function asContent(raw: unknown): ResumeContent {
  const r = parseResumeContent(raw);
  if (!r.ok) throw bad(r.error, 422);
  return r.content;
}

function statsOf(c: ResumeContent) {
  const words = [c.summary ?? "", ...c.experience.flatMap((r) => r.bullets.map((b) => b.text)), ...(c.projects ?? []).flatMap((p) => p.bullets.map((b) => b.text))].join(" ").split(/\s+/).filter(Boolean).length;
  return { roles: c.experience.length, bullets: c.experience.reduce((n, r) => n + r.bullets.length, 0), words };
}

/** A document without its (large) content, for list views. */
function slim(d: ResumeDoc) {
  const { content, ...rest } = d;
  return { ...rest, name: d.name, headline: content.name, stats: statsOf(content) };
}

export function mountResumeRoutes(app: Hono<AppEnv>, ctx: { db: Db; deps: RunnerDeps }) {
  const { db, deps } = ctx;

  /** Domain errors carry their own HTTP status. */
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (e instanceof ResumeDocError) throw bad(e.message, e.status);
      throw e;
    }
  };

  // ---------- templates and fonts ----------

  app.get("/api/resume-templates", (c) => c.json({
    templates: TEMPLATE_IDS.map((id) => {
      const t = TEMPLATES[id];
      return { id, name: t.name, description: t.description, bestFor: t.bestFor, atsSafe: t.atsSafe, columns: t.columns, theme: themeFor(id) };
    }),
    fonts: Object.values(FONTS).map((f) => ({ id: f.id, label: f.label, kind: f.kind })),
    pageSizes: Object.entries(PAGE_SIZES).map(([id, p]) => ({ id, label: p.label })),
  }));

  /** Thumbnail source: the template applied to a sample resume. */
  app.get("/api/resume-templates/:id/preview", (c) => {
    const id = c.req.param("id");
    if (!isTemplateId(id)) throw bad("Unknown template", 404);
    const theme: Record<string, unknown> = {};
    for (const k of ["accent", "font", "headingFont", "pageSize", "headerAlign"]) { const v = c.req.query(k); if (v) theme[k] = v; }
    for (const k of ["fontSize", "lineHeight", "margin", "pages"]) { const v = Number(c.req.query(k)); if (c.req.query(k) && Number.isFinite(v)) theme[k] = v; }
    return c.html(renderResumeHtml(SAMPLE_RESUME, id, theme));
  });

  /** Live preview: render the content as it would print, with the real page count and ATS report. */
  app.post("/api/resume/preview", bodyLimit({ maxSize: 512 * 1024, onError: () => { throw bad("Resume is too large", 413); } }), async (c) => {
    const b = await body(c, z.object({ content: ContentIn, ...StyleIn, requirements: z.unknown().optional() }));
    const content = asContent(b.content);
    const templateId = b.templateId && isTemplateId(b.templateId) ? b.templateId : DEFAULT_TEMPLATE;
    const r = await renderResume(content, { templateId, theme: b.theme, trim: false });
    return c.json({ html: r.html, pages: r.pages, targetPages: r.theme.pages, atsScore: r.atsScore, atsChecks: r.atsChecks, density: r.density, steps: r.steps, theme: r.theme, templateId: r.templateId });
  });

  // ---------- the library ----------

  app.get("/api/resume-docs", async (c) => c.json((await listResumeDocs(db, c.get("user").id)).map(slim)));

  app.post("/api/resume-docs", bodyLimit({ maxSize: 512 * 1024, onError: () => { throw bad("Resume is too large", 413); } }), async (c) => {
    const user = c.get("user");
    const b = await body(c, z.object({
      name: z.string().max(120).optional(), from: z.enum(["graph", "blank", "copy", "content"]).default("graph"),
      copyOf: z.string().optional(), content: ContentIn.optional(), makeDefault: z.boolean().optional(), ...StyleIn,
    }));
    const doc = await guard(async () => {
      if (b.from === "copy") {
        if (!b.copyOf) throw bad("copyOf is required");
        return duplicateResumeDoc(db, user.id, b.copyOf, b.name);
      }
      if (b.from === "blank") return createBlankResumeDoc(db, user.id, b.name || "New resume");
      if (b.from === "content") {
        if (b.content === undefined) throw bad("content is required");
        return createResumeDoc(db, user.id, { name: b.name || "Imported resume", source: "manual", content: asContent(b.content), templateId: b.templateId, theme: b.theme, makeDefault: b.makeDefault });
      }
      return createResumeDocFromGraph(db, user.id, { name: b.name, templateId: b.templateId, theme: b.theme, makeDefault: b.makeDefault });
    });
    return c.json(doc, 201);
  });

  app.get("/api/resume-docs/:id", async (c) => c.json(await guard(() => getResumeDoc(db, c.get("user").id, c.req.param("id")))));

  app.put("/api/resume-docs/:id", bodyLimit({ maxSize: 512 * 1024, onError: () => { throw bad("Resume is too large", 413); } }), async (c) => {
    const b = await body(c, z.object({ name: z.string().max(120).optional(), content: ContentIn.optional(), expectedVersion: z.number().int().optional(), ...StyleIn }));
    const content = b.content === undefined ? undefined : asContent(b.content);
    return c.json(await guard(() => updateResumeDoc(db, c.get("user").id, c.req.param("id"), { name: b.name, content, templateId: b.templateId, theme: b.theme }, { expectedVersion: b.expectedVersion })));
  });

  app.delete("/api/resume-docs/:id", async (c) => {
    await guard(() => deleteResumeDoc(db, c.get("user").id, c.req.param("id")));
    return c.json({ deleted: true });
  });

  app.post("/api/resume-docs/:id/default", async (c) => c.json(await guard(() => setDefaultResumeDoc(db, c.get("user").id, c.req.param("id")))));

  app.post("/api/resume-docs/:id/duplicate", async (c) => {
    const b = await body(c, z.object({ name: z.string().max(120).optional() }));
    return c.json(await guard(() => duplicateResumeDoc(db, c.get("user").id, c.req.param("id"), b.name)), 201);
  });

  app.post("/api/resume-docs/:id/refresh-from-graph", async (c) => c.json(await guard(() => rebuildResumeDocFromGraph(db, c.get("user").id, c.req.param("id")))));

  app.get("/api/resume-docs/:id/versions", async (c) => {
    const vs = await guard(() => listResumeDocVersions(db, c.get("user").id, c.req.param("id")));
    return c.json(vs.map(({ content, ...v }) => ({ ...v, stats: statsOf(content), headline: content.name })));
  });

  app.post("/api/resume-docs/:id/versions/:version/restore", async (c) => {
    const v = Number(c.req.param("version"));
    if (!Number.isInteger(v) || v < 1) throw bad("Invalid version");
    return c.json(await guard(() => restoreResumeDocVersion(db, c.get("user").id, c.req.param("id"), v)));
  });

  const formatOf = (c: Context): Format => {
    const f = (c.req.query("format") ?? "pdf").toLowerCase();
    if (!(FORMATS as readonly string[]).includes(f)) throw bad(`format must be one of ${FORMATS.join(", ")}`);
    return f as Format;
  };

  /** Export in any format: pdf, docx, txt, json, html. ?inline=1 shows PDF and HTML in the browser instead of downloading. */
  app.get("/api/resume-docs/:id/download", async (c) => {
    const doc = await guard(() => getResumeDoc(db, c.get("user").id, c.req.param("id")));
    const format = formatOf(c);
    const inline = c.req.query("inline") === "1";
    const name = resumeFileBase(doc.content.name);
    const key = `doc:${doc.id}:${doc.version}:${format}`;
    let buf = cached(key);
    if (!buf) {
      const theme = doc.theme;
      switch (format) {
        case "pdf": buf = (await renderResume(doc.content, { templateId: isTemplateId(doc.templateId) ? doc.templateId : DEFAULT_TEMPLATE, theme, trim: false })).pdf; break;
        case "docx": buf = await renderResumeDocx(doc.content, doc.templateId, theme); break;
        case "txt": buf = Buffer.from(renderResumeText(doc.content, doc.templateId), "utf8"); break;
        case "json": buf = Buffer.from(renderResumeJson(doc.content, doc.templateId, theme), "utf8"); break;
        case "html": buf = Buffer.from(renderResumeHtml(doc.content, isTemplateId(doc.templateId) ? doc.templateId : DEFAULT_TEMPLATE, theme), "utf8"); break;
      }
      remember(key, buf);
    }
    return download(buf, format, name, inline);
  });

  // ---------- tailored resumes ----------

  /** The same exports for a tailored (per-application) resume. PDF and HTML are the stored render. */
  app.get("/api/resumes/:id/download", async (c) => {
    const id = c.req.param("id");
    if (!uuidOk(id)) throw bad("Resume not found", 404);
    const [r] = await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, c.get("user").id))).limit(1);
    if (!r) throw bad("Resume not found", 404);
    const format = formatOf(c);
    const inline = c.req.query("inline") === "1";
    const name = resumeFileBase(r.content.name, `Resume-v${r.version}`);
    const key = `res:${r.id}:${format}`;
    let buf = cached(key);
    if (!buf) {
      switch (format) {
        case "pdf": {
          if (!r.pdfPath) throw bad("Resume has no PDF", 404);
          buf = Buffer.from(await (await import("node:fs/promises")).readFile(r.pdfPath));
          break;
        }
        case "docx": buf = await renderResumeDocx(r.content, r.templateId, r.theme); break;
        case "txt": buf = Buffer.from(renderResumeText(r.content, r.templateId), "utf8"); break;
        case "json": buf = Buffer.from(renderResumeJson(r.content, r.templateId, r.theme), "utf8"); break;
        case "html": buf = Buffer.from(r.html ?? renderResumeHtml(r.content, isTemplateId(r.templateId) ? r.templateId : DEFAULT_TEMPLATE, r.theme), "utf8"); break;
      }
      remember(key, buf);
    }
    return download(buf, format, name, inline);
  });

  /** Edit the words, template or theme of a resume that is waiting for review. Creates a new version and re-renders it. */
  app.put("/api/applications/:id/resume", bodyLimit({ maxSize: 512 * 1024, onError: () => { throw bad("Resume is too large", 413); } }), async (c) => {
    const user = c.get("user");
    const b = await body(c, z.object({ content: ContentIn.optional(), ...StyleIn }));
    const content = b.content === undefined ? undefined : asContent(b.content);
    const resume = await guard(() => editApplicationResume(db, user.id, c.req.param("id"), { content, templateId: b.templateId, theme: b.theme }, deps));
    const [application] = await db.select().from(applications).where(eq(applications.id, c.req.param("id"))).limit(1);
    const { html: _html, ...slimResume } = resume;
    return c.json({ resume: slimResume, application });
  });
}

/** Public: font files for the live preview and stored resume HTML. Registry names only, long cache. */
export function mountFontRoute(app: Hono<AppEnv>) {
  app.get("/api/resume-fonts/:file", (c) => {
    const buf = readFontFile(c.req.param("file"));
    if (!buf) throw bad("Font not found", 404);
    return new Response(new Uint8Array(buf), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
  });
}
