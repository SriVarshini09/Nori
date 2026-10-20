import type { ResumeContent } from "../db/schema.js";
import { dateRange, displayUrl, escapeHtml as e, hrefOf } from "./format.js";
import { FONTS, fontFaceCss, type FontId } from "./fonts.js";
import {
  DEFAULT_THEME, EXTRA_TITLES, PAGE_SIZES, SECTION_IDS, SECTION_TITLES, applyDensity, normalizeTheme,
  type Density, type ResumeTheme, type SectionId,
} from "./theme.js";

export type TemplateId = "classic" | "modern" | "compact" | "executive" | "minimal" | "technical" | "sidebar";

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
  classic: {
    id: "classic", name: "Classic", columns: 1, atsSafe: true,
    description: "The safe default: one column, black on white, standard headings.",
    bestFor: "Every application, especially large companies with strict parsers.",
    theme: { font: "source-sans", accent: "#1a1a1a", fontSize: 10.75, lineHeight: 1.3, margin: 0.55, headerAlign: "left" },
  },
  modern: {
    id: "modern", name: "Modern", columns: 1, atsSafe: true,
    description: "Clean sans-serif with a single accent colour on headings and rules.",
    bestFor: "Product, design and engineering roles at startups and scale-ups.",
    theme: { font: "inter", accent: "#2563eb", fontSize: 10, lineHeight: 1.36, margin: 0.6, headerAlign: "left" },
  },
  compact: {
    id: "compact", name: "Compact", columns: 1, atsSafe: true,
    description: "Name and contact share one band. Tight spacing fits a long career on one page.",
    bestFor: "Ten or more years of experience, or many roles.",
    theme: { font: "source-sans", accent: "#0f766e", fontSize: 10, lineHeight: 1.22, margin: 0.45, headerAlign: "left" },
  },
  executive: {
    id: "executive", name: "Executive", columns: 1, atsSafe: true,
    description: "Centred serif header with a double rule. Quiet and formal.",
    bestFor: "Leadership, finance, legal and consulting.",
    theme: { font: "garamond", accent: "#4a3b2a", fontSize: 11.5, lineHeight: 1.28, margin: 0.65, headerAlign: "center" },
  },
  minimal: {
    id: "minimal", name: "Minimal", columns: 1, atsSafe: true,
    description: "Generous white space, no rules, small spaced headings.",
    bestFor: "Short resumes with strong, concrete bullets.",
    theme: { font: "inter", accent: "#6b7280", fontSize: 10, lineHeight: 1.38, margin: 0.62, headerAlign: "left" },
  },
  technical: {
    id: "technical", name: "Technical", columns: 1, atsSafe: true,
    description: "Skills first, monospaced labels and dates, an engineer's reading order.",
    bestFor: "Software, data and infrastructure roles.",
    theme: { font: "source-sans", headingFont: "mono", accent: "#7c3aed", fontSize: 10.25, lineHeight: 1.28, margin: 0.5, headerAlign: "left" },
    sections: ["summary", "skills", "experience", "projects", "education", "certifications"],
  },
  sidebar: {
    id: "sidebar", name: "Sidebar", columns: 2, atsSafe: false,
    description: "Coloured side column for contact, skills and education. Eye-catching, but two columns can confuse parsers.",
    bestFor: "Sending directly to a person, not through an applicant tracking system.",
    theme: { font: "inter", accent: "#1e3a5f", fontSize: 9.75, lineHeight: 1.34, margin: 0.4, headerAlign: "left" },
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

function contactItems(c: ResumeContent["contact"]): string[] {
  const out: string[] = [];
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

function sectionBodies(c: ResumeContent): Record<SectionId, string> {
  const summary = c.summary?.trim() ? `<p>${e(c.summary.trim())}</p>` : "";
  const experience = c.experience.map((r) => {
    const when = dateRange(r.start, r.end);
    const heading = [r.title, r.company].filter(Boolean).map((x) => e(x)).join(", ");
    return `<div class="role">\n<h3><span>${heading}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${r.location ? `<p class="sub">${e(r.location)}</p>\n` : ""}${bulletList(r.bullets)}\n</div>`;
  }).join("\n");
  const education = c.education.map((ed) => {
    const deg = [ed.degree, ed.field].filter(Boolean).join(", ");
    const when = dateRange(ed.start, ed.end);
    const left = [deg, ed.school].filter(Boolean).map((x) => e(x!)).join(" - ");
    return `<div class="edu"><h3><span>${left}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3></div>`;
  }).join("\n");
  const rows = c.skills.filter((g) => g.items.length > 0).map((g) => `<p><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</p>`);
  const skills = rows.length ? `<div class="skills">\n${rows.join("\n")}\n</div>` : "";
  const projects = (c.projects ?? []).filter((p) => p.name).map((p) => `<div class="role">\n<h3><span>${e(p.name)}</span></h3>\n${bulletList(p.bullets)}\n</div>`).join("\n");
  const certs = (c.certifications ?? []).filter((x) => x.trim());
  const certifications = certs.length ? bulletList(certs.map((t) => ({ text: t }))) : "";
  return { summary, experience, education, skills, projects, certifications };
}

/** Sections in display order: the resume's own order, else the template's, with hidden and empty ones removed. */
export function resolveSections(c: ResumeContent, template: TemplateMeta): Built[] {
  const bodies = sectionBodies(c);
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
  classic: (t) => `
h1 { font-size: 20pt; font-weight: 700; letter-spacing: .2pt; text-align: ${t.headerAlign}; }
.contact { font-size: .96em; margin: 2pt 0 4pt 0; color: #222; text-align: ${t.headerAlign}; }
.contact span.sep { margin: 0 .35em; }
h2 { font-family: var(--head); font-size: 1.07em; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; margin: 11pt 0 3pt 0; padding-bottom: 1pt; border-bottom: .75pt solid #444; }
.sec:first-of-type h2 { margin-top: 5pt; }`,

  modern: (t) => `
h1 { font-size: 25pt; font-weight: 700; letter-spacing: -.01em; line-height: 1.1; text-align: ${t.headerAlign}; }
.contact { margin: 5pt 0 3pt 0; color: #555; font-size: .95em; text-align: ${t.headerAlign}; }
.contact span.sep { margin: 0 .55em; color: var(--accent); }
h2 { font-family: var(--head); font-size: .88em; text-transform: uppercase; letter-spacing: .16em; font-weight: 700; color: var(--accent); margin: 15pt 0 4pt 0; padding-bottom: 3pt; border-bottom: 1.4pt solid var(--accent); }
.sec:first-of-type h2 { margin-top: 12pt; }
h3 { font-weight: 600; margin-top: 7pt; }
h3 .when { color: #666; font-size: .93em; }
.sub { color: #555; font-style: normal; }
li::marker { color: var(--accent); }
.skills strong { color: var(--accent); font-weight: 600; }`,

  compact: (t) => `
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 14pt; border-bottom: 1.2pt solid var(--accent); padding-bottom: 4pt; }
h1 { font-size: 18pt; font-weight: 700; line-height: 1.05; }
.contact { text-align: right; font-size: .93em; max-width: 62%; color: #333; }
.contact span.sep { margin: 0 .3em; color: #888; }
h2 { font-family: var(--head); font-size: .98em; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; margin: 7pt 0 2pt 0; padding-left: 6pt; border-left: 3pt solid var(--accent); line-height: 1.15; }
h3 { margin-top: 3.5pt; }
ul { padding-left: 12pt; margin-top: 1pt; }
li { margin-bottom: .4pt; }`,

  executive: (t) => `
header { text-align: center; padding-bottom: 7pt; border-bottom: 3pt double var(--accent); margin-bottom: 4pt; }
h1 { font-size: 22pt; font-weight: 400; text-transform: uppercase; letter-spacing: .2em; line-height: 1.15; }
.contact { margin-top: 4pt; font-style: italic; color: #3a3a3a; font-size: .95em; }
.contact span.sep { margin: 0 .6em; color: var(--accent); }
h2 { font-family: var(--head); font-size: 1em; text-transform: uppercase; letter-spacing: .18em; font-weight: 700; color: var(--accent); margin: 12pt 0 3pt 0; padding-bottom: 2pt; border-bottom: .6pt solid var(--accent); }
h3 { margin-top: 6pt; }
h3 .when { font-style: italic; }
.sub { color: #444; }`,

  minimal: (t) => `
h1 { font-size: 22pt; font-weight: 600; letter-spacing: -.005em; text-align: ${t.headerAlign}; }
.contact { margin: 4pt 0 6pt 0; color: #666; font-size: .93em; text-align: ${t.headerAlign}; }
.contact span.sep { margin: 0 .6em; color: #bbb; }
h2 { font-family: var(--head); font-size: .82em; text-transform: uppercase; letter-spacing: .22em; font-weight: 600; color: var(--accent); margin: 15pt 0 5pt 0; }
.sec:first-of-type h2 { margin-top: 10pt; }
h3 { font-weight: 600; margin-top: 7pt; }
h3 .when { color: #777; font-size: .92em; }
.sub { color: #666; font-style: normal; }
li::marker { color: #999; }
ul { margin-top: 3pt; } li { margin-bottom: 2pt; }`,

  technical: (t) => `
h1 { font-size: 21pt; font-weight: 700; letter-spacing: -.01em; text-align: ${t.headerAlign}; }
.contact { margin: 3pt 0 2pt 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: .8em; color: #444; text-align: ${t.headerAlign}; }
.contact span.sep { margin: 0 .5em; color: var(--accent); }
h2 { font-family: var(--head); font-size: .82em; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; color: var(--accent); margin: 12pt 0 3pt 0; padding-bottom: 2pt; border-bottom: .75pt dashed var(--accent); }
.sec:first-of-type h2 { margin-top: 8pt; }
h3 .when { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: .8em; color: #555; font-weight: 400; }
.skills strong { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: .86em; color: var(--accent); font-weight: 700; }
li::marker { color: var(--accent); }`,

  sidebar: (t) => `
@page { margin: 0; }
@media print { html { background: linear-gradient(90deg, var(--accent) 0, var(--accent) 32%, #fff 32%); } .cols { min-height: 100vh; } }
@media screen { body { padding: 0 !important; background: linear-gradient(90deg, var(--accent) 0, var(--accent) 32%, #fff 32%); } .cols { min-height: ${PAGE_SIZES[t.pageSize].heightIn}in; } }
.cols { display: grid; grid-template-columns: 32% 68%; }
.side { color: #f3f6fa; padding: ${t.margin + 0.15}in ${t.margin * 0.7}in ${t.margin}in ${t.margin}in; }
.main { padding: ${t.margin + 0.15}in ${t.margin}in ${t.margin}in ${t.margin * 0.8}in; }
.side h1 { font-size: 21pt; font-weight: 700; line-height: 1.1; margin-bottom: 8pt; color: #fff; overflow-wrap: anywhere; }
.side .contact { font-size: .92em; color: #dbe5f1; }
.side .contact span.item { display: block; margin: 0 0 3pt 0; overflow-wrap: anywhere; }
.side h2 { font-family: var(--head); font-size: .85em; text-transform: uppercase; letter-spacing: .14em; font-weight: 700; color: #fff; margin: 14pt 0 4pt 0; padding-bottom: 2pt; border-bottom: .75pt solid rgba(255,255,255,.55); }
.side .skills p { margin-bottom: 4pt; }
.side h3 { display: block; margin: 0 0 2pt 0; font-weight: 600; }
.side h3 .when { display: block; font-weight: 400; color: #dbe5f1; white-space: normal; }
.side ul { padding-left: 12pt; }
.main h2 { font-family: var(--head); font-size: .95em; text-transform: uppercase; letter-spacing: .14em; font-weight: 700; color: var(--accent); margin: 14pt 0 4pt 0; padding-bottom: 2pt; border-bottom: 1pt solid var(--accent); }
.main .sec:first-child h2 { margin-top: 0; }
.main h3 .when { color: #555; }`,
};

// ---------- document ----------

export type RenderHtmlOptions = {
  /** Where the browser loads font files from. */
  fontBase?: string;
  density?: Density;
};

export const DEFAULT_FONT_BASE = "/api/resume-fonts";

/** A complete, self-contained resume HTML document for a template and theme. */
export function renderResumeHtml(content: ResumeContent, templateId: TemplateId = "classic", themeIn?: unknown, opts: RenderHtmlOptions = {}): string {
  const template = TEMPLATES[isTemplateId(templateId) ? templateId : "classic"];
  const density = opts.density ?? "normal";
  const theme = applyDensity(themeFor(template.id, themeIn), density);
  const fonts: FontId[] = [theme.font, theme.headingFont ?? theme.font];
  if (template.id === "technical" || template.id === "compact") fonts.push("mono");
  const items = contactItems(content.contact);
  const contactHtml = items.length ? `<p class="contact">${items.map((x) => `<span class="item">${x}</span>`).join('<span class="sep">|</span>')}</p>` : "";
  const sections = resolveSections(content, template);

  let body: string;
  if (template.id === "sidebar") {
    const sideIds = new Set(["skills", "education", "certifications"]);
    const side = sections.filter((s) => sideIds.has(s.id) || !(SECTION_IDS as readonly string[]).includes(s.id));
    const main = sections.filter((s) => !side.includes(s));
    const sideContact = items.length ? `<p class="contact">${items.map((x) => `<span class="item">${x}</span>`).join("")}</p>` : "";
    body = `<div class="cols">\n<aside class="side">\n<header>\n<h1>${e(content.name)}</h1>\n${sideContact}\n</header>\n${side.map(wrap).join("\n")}\n</aside>\n<main class="main">\n${main.map(wrap).join("\n")}\n</main>\n</div>`;
  } else {
    body = `<header>\n<h1>${e(content.name)}</h1>\n${contactHtml}\n</header>\n${sections.map(wrap).join("\n")}`;
  }

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
