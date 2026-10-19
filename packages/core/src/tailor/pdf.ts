import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { RenderResult } from "../contracts.js";
import type { JobRequirements, ResumeContent } from "../db/schema.js";
import { renderHtml, type Density } from "./template.js";
import { atsChecks } from "./ats.js";

export type RenderOutcome = RenderResult & {
  /** Content as rendered after the fitting loop (may be trimmed). */
  content: ResumeContent;
  density: Density;
  /** Fitting steps applied, in order, e.g. ["density:compact", "drop:summary"]. */
  steps: string[];
};

export type RenderOptions = { requirements?: JobRequirements | null; maxPages?: number };

/** Count pages in a PDF by its page objects ("/Type /Page", not "/Pages"). */
export function countPdfPages(pdf: Buffer | Uint8Array): number {
  const s = Buffer.from(pdf).toString("latin1");
  const n = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (n > 0) return n;
  const count = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(s);
  return count ? Number(count[1]) : 0;
}

type Variant = { label: string; density: Density; content: ResumeContent };

/** Fitting plan: denser type, then progressively trim the least valuable content. Most recent role is index 0. */
function* fittingPlan(original: ResumeContent): Generator<Variant> {
  let c = structuredClone(original);
  yield { label: "", density: "normal", content: c };
  yield { label: "density:compact", density: "compact", content: c };
  yield { label: "density:tight", density: "tight", content: c };

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

async function renderOnce(page: Page, html: string, outPath: string): Promise<number> {
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "Letter", printBackground: true, path: outPath, preferCSSPageSize: true });
  return countPdfPages(pdf);
}

/**
 * Render a resume to a one-page Letter PDF. Re-renders with denser type and trimmed content until it
 * fits or the plan is exhausted. One browser per call, always closed.
 */
export async function renderPdf(content: ResumeContent, outPath: string, opts: RenderOptions = {}): Promise<RenderOutcome> {
  const maxPages = opts.maxPages ?? 1;
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const applied: string[] = [];
    let last: { v: Variant; html: string; pages: number } | null = null;
    for (const v of fittingPlan(content)) {
      if (v.label) applied.push(v.label);
      const html = renderHtml(v.content, v.density);
      const pages = await renderOnce(page, html, outPath);
      last = { v, html, pages };
      if (pages <= maxPages) break;
    }
    if (!last) throw new Error("renderPdf: nothing rendered");
    const ats = atsChecks(last.v.content, last.html, opts.requirements ?? undefined, last.pages);
    return {
      html: last.html, pdfPath: path.resolve(outPath), pages: last.pages,
      atsScore: ats.score, atsChecks: ats.checks,
      content: last.v.content, density: last.v.density, steps: applied,
    };
  } finally {
    await browser.close();
  }
}

/** Read back a PDF's page count from disk. */
export async function pdfPagesOnDisk(p: string): Promise<number> {
  return countPdfPages(await readFile(p));
}
