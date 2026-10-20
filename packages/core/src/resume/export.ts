import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, TabStopType, TextRun,
  type IParagraphOptions,
} from "docx";
import type { ResumeContent } from "../db/schema.js";
import { dateRange, displayUrl, hrefOf } from "./format.js";
import { TEMPLATES, isTemplateId, resolveSections, themeFor, type TemplateId } from "./templates.js";
import type { FontId } from "./fonts.js";
import { PAGE_SIZES } from "./theme.js";

/** Word cannot embed our web fonts, so each maps to the closest font Word and Google Docs ship with. */
const WORD_FONT: Record<FontId, string> = { "source-sans": "Calibri", inter: "Arial", lora: "Georgia", garamond: "Garamond", mono: "Courier New" };

const hex = (c: string) => c.replace("#", "").toUpperCase();
const twips = (inches: number) => Math.round(inches * 1440);

function contactParts(c: ResumeContent["contact"]): { text: string; link?: string }[] {
  const out: { text: string; link?: string }[] = [];
  if (c.email?.trim()) out.push({ text: c.email.trim(), link: `mailto:${c.email.trim()}` });
  if (c.phone?.trim()) out.push({ text: c.phone.trim() });
  if (c.location?.trim()) out.push({ text: c.location.trim() });
  for (const u of [c.linkedin, c.github, c.website]) if (u?.trim()) out.push({ text: displayUrl(u), link: hrefOf(u) });
  return out;
}

/** An ATS-friendly Word document: one column, real headings, real bullets, the template's accent colour and section order. */
export async function renderResumeDocx(content: ResumeContent, templateId: string = "classic", themeIn?: unknown): Promise<Buffer> {
  const id: TemplateId = isTemplateId(templateId) ? templateId : "classic";
  const template = TEMPLATES[id];
  const theme = themeFor(id, themeIn);
  const font = WORD_FONT[theme.font];
  const headFont = WORD_FONT[theme.headingFont ?? theme.font];
  const size = Math.round(theme.fontSize * 2); // half-points
  const accent = hex(theme.accent);
  const page = PAGE_SIZES[theme.pageSize];
  const right = Math.round((page.widthIn - theme.margin * 2) * 1440);
  const align = theme.headerAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const spacing = (before: number, after: number) => ({ before: Math.round(before * 20), after: Math.round(after * 20), line: Math.round(theme.lineHeight * 240) });
  const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number; font?: string; caps?: boolean } = {}) =>
    new TextRun({ text, font: o.font ?? font, size: o.size ?? size, bold: o.bold, italics: o.italics, color: o.color, allCaps: o.caps });

  const body: Paragraph[] = [];
  const P = (o: IParagraphOptions) => body.push(new Paragraph(o));
  const heading = (title: string) => P({
    spacing: { ...spacing(11, 3), line: 240 }, keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 1 } },
    children: [run(title, { bold: true, color: accent, size: Math.round(size * 0.96), font: headFont, caps: true })],
  });
  const bullets = (items: { text: string }[]) => {
    for (const b of items) if (b.text.trim()) P({ numbering: { reference: "bul", level: 0 }, spacing: spacing(0, 1), children: [run(b.text.trim())] });
  };
  const roleLine = (left: string, when: string) => P({
    tabStops: [{ type: TabStopType.RIGHT, position: right }], spacing: spacing(5, 1), keepNext: true,
    children: [run(left, { bold: true }), ...(when ? [new TextRun({ text: "\t", font, size }), run(when)] : [])],
  });

  // header
  P({ alignment: align, spacing: { before: 0, after: 40 }, children: [run(content.name || "Your Name", { bold: true, size: Math.round(size * 1.9), font: headFont, color: id === "classic" ? undefined : accent })] });
  const parts = contactParts(content.contact);
  if (parts.length) {
    const kids: (TextRun | ExternalHyperlink)[] = [];
    parts.forEach((p, i) => {
      if (i) kids.push(run("  |  ", { color: "777777" }));
      kids.push(p.link
        ? new ExternalHyperlink({ link: p.link, children: [run(p.text, { color: "1F3A8A" })] })
        : run(p.text));
    });
    P({ alignment: align, spacing: spacing(0, 2), children: kids });
  }

  for (const s of resolveSections(content, template)) {
    heading(s.title);
    switch (s.id) {
      case "summary": P({ spacing: spacing(0, 2), children: [run((content.summary ?? "").trim())] }); break;
      case "experience":
        for (const r of content.experience) {
          roleLine([r.title, r.company].filter(Boolean).join(", "), dateRange(r.start, r.end));
          if (r.location) P({ spacing: spacing(0, 1), children: [run(r.location, { italics: true })] });
          bullets(r.bullets);
        }
        break;
      case "education":
        for (const e of content.education) roleLine([[e.degree, e.field].filter(Boolean).join(", "), e.school].filter(Boolean).join(" - "), dateRange(e.start, e.end));
        break;
      case "skills":
        for (const g of content.skills) if (g.items.length) P({ spacing: spacing(0, 1.5), children: [run(`${g.group}: `, { bold: true }), run(g.items.join(", "))] });
        break;
      case "projects":
        for (const p of content.projects ?? []) { if (!p.name) continue; roleLine(p.name, ""); bullets(p.bullets); }
        break;
      case "certifications": bullets((content.certifications ?? []).map((text) => ({ text }))); break;
      default: {
        const extra = (content.extras ?? []).find((x) => x.title === s.title);
        if (extra) bullets(extra.items.map((text) => ({ text })));
      }
    }
  }

  const doc = new Document({
    creator: content.name || "Nori",
    title: `${content.name || "Resume"} - Resume`,
    styles: { default: { document: { run: { font, size } } } },
    numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: twips(page.widthIn), height: twips(page.heightIn) }, margin: { top: twips(theme.margin), bottom: twips(theme.margin), left: twips(theme.margin), right: twips(theme.margin) } } },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}

/** Plain text for pasting into an application form or an email. */
export function renderResumeText(content: ResumeContent, templateId: string = "classic"): string {
  const template = TEMPLATES[isTemplateId(templateId) ? templateId : "classic"];
  const out: string[] = [content.name || ""];
  const contact = contactParts(content.contact).map((p) => p.text);
  if (contact.length) out.push(contact.join(" | "));
  for (const s of resolveSections(content, template)) {
    out.push("", s.title.toUpperCase());
    switch (s.id) {
      case "summary": out.push((content.summary ?? "").trim()); break;
      case "experience":
        for (const r of content.experience) {
          out.push([[r.title, r.company].filter(Boolean).join(", "), dateRange(r.start, r.end)].filter(Boolean).join("  |  "));
          if (r.location) out.push(r.location);
          for (const b of r.bullets) if (b.text.trim()) out.push(`- ${b.text.trim()}`);
        }
        break;
      case "education":
        for (const e of content.education) out.push([[e.degree, e.field].filter(Boolean).join(", "), e.school, dateRange(e.start, e.end)].filter(Boolean).join(" - "));
        break;
      case "skills": for (const g of content.skills) if (g.items.length) out.push(`${g.group}: ${g.items.join(", ")}`); break;
      case "projects":
        for (const p of content.projects ?? []) { if (!p.name) continue; out.push(p.name); for (const b of p.bullets) if (b.text.trim()) out.push(`- ${b.text.trim()}`); }
        break;
      case "certifications": for (const c of content.certifications ?? []) if (c.trim()) out.push(`- ${c.trim()}`); break;
      default: {
        const extra = (content.extras ?? []).find((x) => x.title === s.title);
        for (const i of extra?.items ?? []) out.push(`- ${i}`);
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** The resume as portable JSON: content, template and theme. */
export function renderResumeJson(content: ResumeContent, templateId: string, theme: unknown): string {
  return JSON.stringify({ format: "nori-resume", version: 1, template: templateId, theme, content }, null, 2) + "\n";
}

const TRANSLIT: Record<string, string> = { "Ł": "L", "ł": "l", "Ø": "O", "ø": "o", "Đ": "D", "đ": "d", "ß": "ss", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe", "Þ": "Th", "þ": "th", "Ð": "D", "ð": "d", "İ": "I", "ı": "i" };

/** A safe download name: "Jordan Rivera" -> "Jordan-Rivera-Resume". Accents and special letters become plain ASCII. */
export function resumeFileBase(name: string | undefined, suffix = "Resume"): string {
  const base = (name ?? "").replace(/[ŁłØøĐđßÆæŒœÞþÐðİı]/g, (c) => TRANSLIT[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "My"}-${suffix}`.slice(0, 80);
}
