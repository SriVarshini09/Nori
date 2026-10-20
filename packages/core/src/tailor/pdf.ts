import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderResult } from "../contracts.js";
import type { JobRequirements, ResumeContent } from "../db/schema.js";
import { countPdfPages, renderResume } from "../resume/render.js";
import type { TemplateId } from "../resume/templates.js";
import type { Density } from "../resume/theme.js";

export { countPdfPages };

export type RenderOutcome = RenderResult & {
  /** Content as rendered after the fitting loop (may be trimmed). */
  content: ResumeContent;
  density: Density;
  /** Fitting steps applied, in order, e.g. ["density:compact", "drop:summary"]. */
  steps: string[];
};

export type RenderOptions = { requirements?: JobRequirements | null; maxPages?: number; templateId?: TemplateId; theme?: unknown };

/**
 * Render a tailored resume to a Letter or A4 PDF at outPath. Re-renders with denser type and trimmed content until it
 * fits the page target (one page unless the theme says otherwise) or the plan is exhausted.
 */
export async function renderPdf(content: ResumeContent, outPath: string, opts: RenderOptions = {}): Promise<RenderOutcome> {
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  const r = await renderResume(content, { templateId: opts.templateId, theme: opts.theme, requirements: opts.requirements, maxPages: opts.maxPages, trim: true });
  await writeFile(outPath, r.pdf);
  return {
    html: r.html, pdfPath: path.resolve(outPath), pages: r.pages, atsScore: r.atsScore, atsChecks: r.atsChecks,
    content: r.content, density: r.density, steps: r.steps,
  };
}

/** Read back a PDF's page count from disk. */
export async function pdfPagesOnDisk(p: string): Promise<number> {
  return countPdfPages(await readFile(p));
}
