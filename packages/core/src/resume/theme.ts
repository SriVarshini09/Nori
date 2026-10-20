import { z } from "zod";
import type { ResumeContent } from "../db/schema.js";
import { FONT_IDS, type FontId } from "./fonts.js";

/** Section ids in the order ATS parsers and recruiters expect. */
export const SECTION_IDS = ["summary", "experience", "education", "skills", "projects", "certifications"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Record<SectionId, string> = {
  summary: "Summary", experience: "Experience", education: "Education", skills: "Skills", projects: "Projects", certifications: "Certifications",
};
/** Titles allowed for extra sections. Standard words keep parsers happy. */
export const EXTRA_TITLES = ["Awards", "Languages", "Volunteer Experience", "Publications", "Interests", "Leadership", "Activities"] as const;

export type PageSize = "letter" | "a4";
export const PAGE_SIZES: Record<PageSize, { label: string; widthIn: number; heightIn: number; css: string }> = {
  letter: { label: "US Letter", widthIn: 8.5, heightIn: 11, css: "Letter" },
  a4: { label: "A4", widthIn: 8.2677, heightIn: 11.6929, css: "A4" },
};

export type ResumeTheme = {
  font: FontId;
  /** Heading font; defaults to the body font. */
  headingFont?: FontId;
  /** #rrggbb */
  accent: string;
  /** Body size in pt. */
  fontSize: number;
  lineHeight: number;
  /** Page margin in inches. */
  margin: number;
  pageSize: PageSize;
  headerAlign: "left" | "center";
  /** Target page count the fitter aims for (1 to 3). */
  pages: number;
};

export const DEFAULT_THEME: ResumeTheme = {
  font: "source-sans", accent: "#1f3a5f", fontSize: 10.75, lineHeight: 1.3, margin: 0.55, pageSize: "letter", headerAlign: "left", pages: 1,
};

export const ThemeSchema = z.object({
  font: z.enum(FONT_IDS as [FontId, ...FontId[]]),
  headingFont: z.enum(FONT_IDS as [FontId, ...FontId[]]).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Accent must be a #rrggbb colour"),
  fontSize: z.number().min(8.5).max(13),
  lineHeight: z.number().min(1.05).max(1.7),
  margin: z.number().min(0.35).max(1.1),
  pageSize: z.enum(["letter", "a4"]),
  headerAlign: z.enum(["left", "center"]),
  pages: z.number().int().min(1).max(3),
}).strict();

/** Fill any missing or invalid field from the defaults, and clamp numbers to their ranges. Never throws. */
export function normalizeTheme(input: unknown, base: ResumeTheme = DEFAULT_THEME): ResumeTheme {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const font = FONT_IDS.includes(o.font as FontId) ? (o.font as FontId) : base.font;
  const headingFont = FONT_IDS.includes(o.headingFont as FontId) ? (o.headingFont as FontId) : base.headingFont;
  return {
    font,
    ...(headingFont ? { headingFont } : {}),
    accent: typeof o.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(o.accent) ? o.accent.toLowerCase() : base.accent,
    fontSize: num(o.fontSize, 8.5, 13, base.fontSize),
    lineHeight: num(o.lineHeight, 1.05, 1.7, base.lineHeight),
    margin: num(o.margin, 0.35, 1.1, base.margin),
    pageSize: o.pageSize === "a4" || o.pageSize === "letter" ? o.pageSize : base.pageSize,
    headerAlign: o.headerAlign === "center" || o.headerAlign === "left" ? o.headerAlign : base.headerAlign,
    pages: typeof o.pages === "number" && Number.isFinite(o.pages) ? Math.min(3, Math.max(1, Math.round(o.pages))) : base.pages,
  };
}

/** Fitting levels: tighter type and margins, used to pull a resume onto the page limit without touching its words. */
export type Density = "normal" | "compact" | "tight";
export function applyDensity(theme: ResumeTheme, density: Density): ResumeTheme {
  if (density === "normal") return theme;
  const d = density === "compact" ? { fs: 0.4, lh: 0.07, m: 0.08 } : { fs: 0.85, lh: 0.14, m: 0.16 };
  return {
    ...theme,
    fontSize: Math.max(8.5, +(theme.fontSize - d.fs).toFixed(2)),
    lineHeight: Math.max(1.05, +(theme.lineHeight - d.lh).toFixed(2)),
    margin: Math.max(0.35, +(theme.margin - d.m).toFixed(2)),
  };
}

// ---------- content validation (editor and API input) ----------

const short = (n: number) => z.string().max(n);
const BulletSchema = z.object({
  id: z.string().max(80).optional(),
  text: short(600),
  nodeIds: z.array(z.string().max(80)).max(20).optional(),
  edited: z.boolean().optional(),
});
const Dateish = short(40).optional();

export const ResumeContentSchema = z.object({
  name: short(120),
  contact: z.object({
    email: short(200).optional(), phone: short(60).optional(), location: short(160).optional(),
    linkedin: short(300).optional(), website: short(300).optional(), github: short(300).optional(),
  }).default({}),
  summary: short(1200).optional(),
  experience: z.array(z.object({
    title: short(160), company: short(160), location: short(160).optional(), start: Dateish, end: Dateish,
    bullets: z.array(BulletSchema).max(30),
  })).max(30).default([]),
  education: z.array(z.object({
    school: short(200), degree: short(160).optional(), field: short(160).optional(), start: Dateish, end: Dateish,
  })).max(12).default([]),
  skills: z.array(z.object({ group: short(80), items: z.array(short(80)).max(60) })).max(14).default([]),
  projects: z.array(z.object({ name: short(160), bullets: z.array(BulletSchema).max(12) })).max(12).optional(),
  certifications: z.array(short(200)).max(20).optional(),
  extras: z.array(z.object({ title: z.enum(EXTRA_TITLES), items: z.array(short(300)).max(20) })).max(7).optional(),
  layout: z.object({ sections: z.array(z.enum(SECTION_IDS)).max(6).optional(), hidden: z.array(z.enum(SECTION_IDS)).max(6).optional() }).optional(),
});

let bulletSeq = 0;
/** Validate and normalise editor input into a ResumeContent: every bullet gets a stable id, empty rows are dropped. */
export function parseResumeContent(input: unknown): { ok: true; content: ResumeContent } | { ok: false; error: string } {
  const r = ResumeContentSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "resume"}: ${i.message}`).join("; ") };
  const d = r.data;
  const fix = (prefix: string, bs: { id?: string; text: string; nodeIds?: string[]; edited?: boolean }[]) => {
    const used = new Set<string>();
    return bs.map((b) => ({ ...b, text: b.text.trim() })).filter((b) => b.text).map((b, i) => {
      let id = b.id && !used.has(b.id) ? b.id : `${prefix}-n${Date.now().toString(36)}${(bulletSeq++).toString(36)}${i}`;
      used.add(id);
      return { id, text: b.text, nodeIds: b.nodeIds ?? [], ...(b.edited ? { edited: true } : {}) };
    });
  };
  const content: ResumeContent = {
    name: d.name.trim(),
    contact: Object.fromEntries(Object.entries(d.contact).map(([k, v]) => [k, (v ?? "").trim()]).filter(([, v]) => v)) as ResumeContent["contact"],
    ...(d.summary?.trim() ? { summary: d.summary.trim() } : {}),
    experience: d.experience.filter((x) => x.title.trim() || x.company.trim()).map((x, i) => ({
      title: x.title.trim(), company: x.company.trim(),
      ...(x.location?.trim() ? { location: x.location.trim() } : {}),
      ...(x.start?.trim() ? { start: x.start.trim() } : {}), ...(x.end?.trim() ? { end: x.end.trim() } : {}),
      bullets: fix(`e${i}`, x.bullets),
    })),
    education: d.education.filter((e) => e.school.trim()).map((e) => ({
      school: e.school.trim(), ...(e.degree?.trim() ? { degree: e.degree.trim() } : {}), ...(e.field?.trim() ? { field: e.field.trim() } : {}),
      ...(e.start?.trim() ? { start: e.start.trim() } : {}), ...(e.end?.trim() ? { end: e.end.trim() } : {}),
    })),
    skills: d.skills.map((g) => ({ group: g.group.trim(), items: g.items.map((i) => i.trim()).filter(Boolean) })).filter((g) => g.group && g.items.length),
    ...(d.projects?.length ? { projects: d.projects.filter((p) => p.name.trim()).map((p, i) => ({ name: p.name.trim(), bullets: fix(`p${i}`, p.bullets) })) } : {}),
    ...(d.certifications?.length ? { certifications: d.certifications.map((c) => c.trim()).filter(Boolean) } : {}),
    ...(d.extras?.length ? { extras: d.extras.map((x) => ({ title: x.title, items: x.items.map((i) => i.trim()).filter(Boolean) })).filter((x) => x.items.length) } : {}),
    ...(d.layout ? { layout: { ...(d.layout.sections ? { sections: d.layout.sections } : {}), ...(d.layout.hidden ? { hidden: d.layout.hidden } : {}) } } : {}),
  };
  return { ok: true, content };
}
