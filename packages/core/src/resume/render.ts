import type { AtsCheck, JobRequirements, ResumeContent } from "../db/schema.js";
import { atsChecks } from "../tailor/ats.js";
import { withPage } from "./browser.js";
import { readFontFile } from "./fonts.js";
import { PAGE_SIZES, type Density, type ResumeTheme } from "./theme.js";
import { DEFAULT_TEMPLATE, renderResumeHtml, themeFor, type TemplateId } from "./templates.js";

/** Count pages in a PDF by its page objects ("/Type /Page", not "/Pages"). */
export function countPdfPages(pdf: Buffer | Uint8Array): number {
  const s = Buffer.from(pdf).toString("latin1");
  const n = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (n > 0) return n;
  const count = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(s);
  return count ? Number(count[1]) : 0;
}

export type ResumeRenderOptions = {
  templateId?: TemplateId;
  /** Partial theme; missing fields come from the template. */
  theme?: unknown;
  requirements?: JobRequirements | null;
  /** Override the theme's target page count. */
  maxPages?: number;
  /** Allow the fitter to cut content (oldest roles, extra bullets) to reach the page target. Tailored resumes yes, a user's own document no. */
  trim?: boolean;
};

export type ResumeRenderOutcome = {
  pdf: Buffer;
  /** Document with fonts served from /api/resume-fonts; safe to store and to show in a same-origin frame. */
  html: string;
  pages: number;
  atsScore: number;
  atsChecks: AtsCheck[];
  /** Content as rendered after fitting (may be trimmed when `trim` is on). */
  content: ResumeContent;
  density: Density;
  /** Fitting steps applied, in order, e.g. ["density:compact", "drop:summary"]. */
  steps: string[];
  templateId: TemplateId;
  theme: ResumeTheme;
};

type Variant = { label: string; density: Density; content: ResumeContent };

/** Fitting plan: tighter type first; then, only if allowed, progressively trim the least valuable content. Most recent role is index 0. */
export function* fittingPlan(original: ResumeContent, trim: boolean): Generator<Variant> {
  let c = structuredClone(original);
  yield { label: "", density: "normal", content: c };
  yield { label: "density:compact", density: "compact", content: c };
  yield { label: "density:tight", density: "tight", content: c };
  if (!trim) return;

  if (c.summary) {
    c = { ...structuredClone(c), summary: undefined };
    yield { label: "drop:summary", density: "tight", content: c };
  }
  // trim roles to 2 bullets, oldest first (never the most recent role)
  for (let i = c.experience.length - 1; i >= 1; i--) {
    if (c.experience[i].bullets.length <= 2) continue;
    c = structuredClone(c);
    c.experience[i].bullets = c.experience[i].bullets.slice(0, 2);
    yield { label: `trim:role${i}`, density: "tight", content: c };
  }
  // drop roles beyond the third, oldest first
  while (c.experience.length > 3) {
    c = structuredClone(c);
    const gone = c.experience.pop()!;
    yield { label: `drop:role(${gone.company || gone.title})`, density: "tight", content: c };
  }
  // last resorts: projects, then cap recent roles at 3 bullets
  if (c.projects?.length) {
    c = { ...structuredClone(c), projects: [] };
    yield { label: "drop:projects", density: "tight", content: c };
  }
  for (let i = c.experience.length - 1; i >= 0; i--) {
    if (c.experience[i].bullets.length <= 3) continue;
    c = structuredClone(c);
    c.experience[i].bullets = c.experience[i].bullets.slice(0, 3);
    yield { label: `trim:role${i}:3`, density: "tight", content: c };
  }
}

const FONT_HOST = "https://fonts.nori.invalid";

async function toPdf(html: string, theme: ResumeTheme): Promise<Buffer> {
  return withPage(async (page) => {
    await page.route(`${FONT_HOST}/**`, (route) => {
      const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      const body = readFontFile(file);
      if (!body) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*", "cache-control": "max-age=3600" }, body });
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ format: PAGE_SIZES[theme.pageSize].css, printBackground: true, preferCSSPageSize: true }));
  });
}

/**
 * Render a resume with a template and theme to a PDF buffer, refitting inside a single warm Playwright page
 * until it reaches the page target or the plan runs out. Returns the best attempt with its real page count and ATS report.
 */
export async function renderResume(content: ResumeContent, opts: ResumeRenderOptions = {}): Promise<ResumeRenderOutcome> {
  const templateId = opts.templateId ?? DEFAULT_TEMPLATE;
  const theme = themeFor(templateId, opts.theme);
  const maxPages = opts.maxPages ?? theme.pages;
  const steps: string[] = [];

  const last = await withPage(async (page) => {
    await page.route(`${FONT_HOST}/**`, (route) => {
      const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      const body = readFontFile(file);
      if (!body) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*", "cache-control": "max-age=3600" }, body });
    });

    let cur: { v: Variant; pdf: Buffer; pages: number } | null = null;
    for (const v of fittingPlan(content, opts.trim ?? false)) {
      if (v.label) steps.push(v.label);
      const html = renderResumeHtml(v.content, templateId, opts.theme, { fontBase: FONT_HOST, density: v.density });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      const pdf = Buffer.from(await page.pdf({ format: PAGE_SIZES[theme.pageSize].css, printBackground: true, preferCSSPageSize: true }));
      cur = { v, pdf, pages: countPdfPages(pdf) };
      if (cur.pages <= maxPages) break;
    }
    return cur;
  });

  if (!last) throw new Error("renderResume: nothing rendered");
  const html = renderResumeHtml(last.v.content, templateId, opts.theme, { density: last.v.density });
  const ats = atsChecks(last.v.content, html, opts.requirements ?? undefined, last.pages, maxPages);
  return {
    pdf: last.pdf, html, pages: last.pages, atsScore: ats.score, atsChecks: ats.checks,
    content: last.v.content, density: last.v.density, steps, templateId, theme,
  };
}
