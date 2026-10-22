import type { ResumeContent } from "../db/schema.js";
import { renderResumeHtml } from "../resume/templates.js";
import { SECTION_TITLES, type Density } from "../resume/theme.js";

export type { Density };
export { escapeHtml, formatDate, dateRange } from "../resume/format.js";

/** Section headings in the order ATS parsers and recruiters expect. */
export const SECTION_ORDER = ["Summary", "Experience", "Education", "Skills", "Projects", "Certifications"] as const;
void SECTION_TITLES;

/** Single-column, ATS-safe resume HTML in the Classic template. Kept for callers that do not pick a template. */
export function renderHtml(content: ResumeContent, density: Density = "normal"): string {
  return renderResumeHtml(content, "classic", undefined, { density });
}
