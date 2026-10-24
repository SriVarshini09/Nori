import type { ResumeContent } from "../db/schema.js";
import { dateRange, displayUrl, escapeHtml as e, hrefOf } from "./format.js";
import { FONTS, fontFaceCss, type FontId } from "./fonts.js";
import {
  DEFAULT_THEME, EXTRA_TITLES, PAGE_SIZES, SECTION_IDS, SECTION_TITLES, applyDensity, normalizeTheme,
  type Density, type ResumeTheme, type SectionId,
} from "./theme.js";

export type TemplateId = "ats";
/** The template new resumes and tailored resumes use unless the person picks another. */
export const DEFAULT_TEMPLATE: TemplateId = "ats";

export type TemplateMeta = {
  id: TemplateId;
  name: string;
  description: string;
  bestFor: string;
  /** Single column, plain headings, no tables or images: parsers read it in order. */
  atsSafe: boolean;
  columns: 1 | 2;
  /** Theme applied when the user picks this template (font, accent, spacing). */
  theme: Partial<ResumeTheme>;
  /** Section order the template prefers when the resume sets none. */
  sections?: SectionId[];
};

export const TEMPLATES: Record<TemplateId, TemplateMeta> = {
  ats: {
    id: "ats", name: "ATS Standard", columns: 1, atsSafe: true,
    description: "The parser-first one-pager: centred name, plain bold headings with a rule, company-first roles, Times type, tight spacing.",
    bestFor: "Workday, Greenhouse and every other applicant tracking system. The one template Nori uses.",
    theme: { font: "tinos", accent: "#000000", fontSize: 10.5, lineHeight: 1.2, margin: 0.5, headerAlign: "center" },
    sections: ["summary", "skills", "experience", "education", "projects", "certifications"],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
export const isTemplateId = (v: unknown): v is TemplateId => typeof v === "string" && v in TEMPLATES;

/** Theme for a template: defaults, then the template's look, then the user's overrides. */
export function themeFor(templateId: TemplateId, overrides?: unknown): ResumeTheme {
  const base = normalizeTheme({ ...DEFAULT_THEME, ...TEMPLATES[templateId].theme });
  return normalizeTheme(overrides, base);
}

// ---------- shared markup ----------

type Style = "default" | "ats";

function contactItems(c: ResumeContent["contact"], style: Style = "default"): string[] {
  const out: string[] = [];
  if (style === "ats") {
    // Location | phone | email | LinkedIn | GitHub | Portfolio, links shown by their label (the href keeps the address).
    if (c.location?.trim()) out.push(e(c.location.trim()));
    if (c.phone?.trim()) out.push(e(c.phone.trim()));
    if (c.email?.trim()) out.push(`<a href="mailto:${e(c.email.trim())}">${e(c.email.trim())}</a>`);
    for (const [u, label] of [[c.linkedin, "LinkedIn"], [c.github, "GitHub"], [c.website, "Portfolio"]] as const) {
      if (u?.trim()) out.push(`<a href="${e(hrefOf(u))}">${label}</a>`);
    }
    return out;
  }
  if (c.email?.trim()) out.push(`<a href="mailto:${e(c.email.trim())}">${e(c.email.trim())}</a>`);
  if (c.phone?.trim()) out.push(e(c.phone.trim()));
  if (c.location?.trim()) out.push(e(c.location.trim()));
  for (const u of [c.linkedin, c.github, c.website]) if (u?.trim()) out.push(`<a href="${e(hrefOf(u))}">${e(displayUrl(u))}</a>`);
  return out;
}

function bulletList(items: { text: string }[]): string {
  const li = items.map((b) => b.text.trim()).filter(Boolean).map((t) => `<li>${e(t)}</li>`);
  return li.length ? `<ul>\n${li.join("\n")}\n</ul>` : "";
}

type Built = { id: string; title: string; html: string };

function sectionBodies(c: ResumeContent, style: Style = "default"): Record<SectionId, string> {
  const summary = c.summary?.trim() ? `<p>${e(c.summary.trim())}</p>` : "";
  const experience = c.experience.map((r) => {
    const when = dateRange(r.start, r.end);
    if (style === "ats") {
      // Company first in bold with the dates on the right; title and location on the line below. What Workday-style parsers read best.
      const sub = [r.title, r.location].filter(Boolean).map((x) => e(x!)).join(" \u00b7 ");
      return `<div class="role">\n<h3><span>${e(r.company || r.title)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${sub && r.company ? `<p class="sub">${sub}</p>\n` : ""}${bulletList(r.bullets)}\n</div>`;
    }
    const heading = [r.title, r.company].filter(Boolean).map((x) => e(x)).join(", ");
    return `<div class="role">\n<h3><span>${heading}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${r.location ? `<p class="sub">${e(r.location)}</p>\n` : ""}${bulletList(r.bullets)}\n</div>`;
  }).join("\n");
  const education = c.education.map((ed) => {
    const when = dateRange(ed.start, ed.end);
    if (style === "ats") {
      const deg = ed.degree && ed.field ? `${ed.degree} in ${ed.field}` : ed.degree || ed.field || "";
      return `<div class="edu"><h3><span>${e(ed.school)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>${deg ? `<p class="sub">${e(deg)}</p>` : ""}</div>`;
    }
    const deg = [ed.degree, ed.field].filter(Boolean).join(", ");
    const left = [deg, ed.school].filter(Boolean).map((x) => e(x!)).join(" - ");
    return `<div class="edu"><h3><span>${left}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3></div>`;
  }).join("\n");
  const rows = c.skills.filter((g) => g.items.length > 0).map((g) => (style === "ats"
    ? `<li><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</li>`
    : `<p><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</p>`));
  const skills = rows.length ? (style === "ats" ? `<div class="skills">\n<ul>\n${rows.join("\n")}\n</ul>\n</div>` : `<div class="skills">\n${rows.join("\n")}\n</div>`) : "";
  const projects = (c.projects ?? []).filter((p) => p.name).map((p) => `<div class="role">\n<h3><span>${e(p.name)}</span></h3>\n${bulletList(p.bullets)}\n</div>`).join("\n");
  const certs = (c.certifications ?? []).filter((x) => x.trim());
  const certifications = certs.length ? bulletList(certs.map((t) => ({ text: t }))) : "";
  return { summary, experience, education, skills, projects, certifications };
}

/** Sections in display order: the resume's own order, else the template's, with hidden and empty ones removed. */
export function resolveSections(c: ResumeContent, template: TemplateMeta): Built[] {
  const bodies = sectionBodies(c, template.id === "ats" ? "ats" : "default");
  const hidden = new Set(c.layout?.hidden ?? []);
  const wanted = c.layout?.sections?.length ? c.layout.sections : template.sections ?? [...SECTION_IDS];
  const order = [...new Set<SectionId>([...(wanted as SectionId[]), ...SECTION_IDS])];
  const built: Built[] = order.filter((id) => !hidden.has(id) && bodies[id]).map((id) => ({ id, title: SECTION_TITLES[id], html: bodies[id] }));
  for (const x of c.extras ?? []) {
    const items = x.items.filter((i) => i.trim());
    if (!items.length || !(EXTRA_TITLES as readonly string[]).includes(x.title)) continue;
    built.push({ id: x.title.toLowerCase().replace(/\s+/g, "-"), title: x.title, html: bulletList(items.map((text) => ({ text }))) });
  }
  return built;
}

const wrap = (s: Built) => `<section class="sec" id="${s.id}">\n<h2>${s.title}</h2>\n${s.html}\n</section>`;

// ---------- styles ----------

function baseCss(t: ResumeTheme, density: Density): string {
  const page = PAGE_SIZES[t.pageSize];
  const body = FONTS[t.font].stack;
  const head = FONTS[t.headingFont ?? t.font].stack;
  void density;
  return `
@page { size: ${page.css}; margin: ${t.margin}in; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${body}; font-size: ${t.fontSize}pt; line-height: ${t.lineHeight}; color: #151515; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --accent: ${t.accent}; --head: ${head}; --body: ${body}; --fs: ${t.fontSize}pt; }
a { color: inherit; text-decoration: none; }
.contact .item { white-space: nowrap; }
p { margin: 0; }
ul { margin: 2pt 0 0 0; padding-left: 14pt; }
li { margin: 0 0 1.2pt 0; break-inside: avoid; }
h1, h2, h3 { margin: 0; break-after: avoid; }
.role, .edu { break-inside: avoid-page; }
h3 { display: flex; justify-content: space-between; gap: 10pt; font-size: 1em; font-weight: 700; margin: 6pt 0 1pt 0; }
h3 .when { font-weight: 400; white-space: nowrap; }
.sub { font-style: italic; margin: 0 0 1pt 0; }
.skills p { margin: 0 0 1.5pt 0; }
.edu { margin: 3pt 0 0 0; }
.edu h3 { margin-top: 0; }
@media screen {
  html { background: #e9e7e2; }
  body { width: ${page.widthIn}in; min-height: ${page.heightIn}in; margin: 14px auto; padding: ${t.margin}in; box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08); }
}`;
}

const CSS: Record<TemplateId, (t: ResumeTheme) => string> = {
  // Mirrors a LaTeX one-pager that Workday and the big parsers read cleanly: Times at 10.5pt, half-inch sides with a
  // shorter top margin, bold section titles over a thin rule, no colour, bullets with no gaps.
  ats: (t) => {
    const top = (t.margin * 0.6).toFixed(2), bottom = (t.margin * 0.8).toFixed(2);
    return `
@page { margin: ${top}in ${t.margin}in ${bottom}in ${t.margin}in; }
@media screen { body { padding: ${top}in ${t.margin}in ${bottom}in ${t.margin}in; } }
body { color: #000; }
header { text-align: center; }
h1 { font-size: 17pt; font-weight: 700; line-height: 1.15; }
.contact { font-size: .9em; margin: 2pt 0 0 0; color: #000; }
.contact span.sep { margin: 0 .3em; }
h2 { font-family: var(--head); font-size: 1em; font-weight: 700; margin: 5pt 0 1pt 0; padding-bottom: 0; border-bottom: .6pt solid #000; line-height: 1.2; }
.sec:first-of-type h2 { margin-top: 4pt; }
h3 { margin: 3pt 0 0 0; font-weight: 700; }
h3 .when { font-weight: 400; }
.sub { font-style: normal; margin: 0; }
ul { padding-left: 13pt; margin-top: 0; }
li { margin: 0; }
.edu { margin-top: 2pt; }`;
  },
};

// ---------- document ----------

export type RenderHtmlOptions = {
  /** Where the browser loads font files from. */
  fontBase?: string;
  density?: Density;
};

export const DEFAULT_FONT_BASE = "/api/resume-fonts";

/** A complete, self-contained resume HTML document for a template and theme. */
export function renderResumeHtml(content: ResumeContent, templateId: TemplateId = DEFAULT_TEMPLATE, themeIn?: unknown, opts: RenderHtmlOptions = {}): string {
  const template = TEMPLATES[isTemplateId(templateId) ? templateId : DEFAULT_TEMPLATE];
  const density = opts.density ?? "normal";
  const theme = applyDensity(themeFor(template.id, themeIn), density);
  const fonts: FontId[] = [theme.font, theme.headingFont ?? theme.font];
  const items = contactItems(content.contact, template.id === "ats" ? "ats" : "default");
  const contactHtml = items.length ? `<p class="contact">${items.map((x) => `<span class="item">${x}</span>`).join('<span class="sep">|</span>')}</p>` : "";
  const sections = resolveSections(content, template);

  const body = `<header>\n<h1>${e(content.name)}</h1>\n${contactHtml}\n</header>\n${sections.map(wrap).join("\n")}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(content.name || "Resume")} - Resume</title>
<style>
${fontFaceCss(fonts, opts.fontBase ?? DEFAULT_FONT_BASE)}
${baseCss(theme, density)}
${CSS[template.id](theme)}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
