import { afterAll, describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import type { ResumeContent } from "../db/schema.js";
import { atsChecks } from "../tailor/ats.js";
import { closeSharedBrowser } from "./browser.js";
import { FONT_IDS, fontFaceCss, fontFiles, readFontFile } from "./fonts.js";
import { renderResume } from "./render.js";
import { SAMPLE_PERSONAS, SAMPLE_RESUME, STUDENT_RESUME } from "./sample-content.js";
import { TEMPLATES, TEMPLATE_IDS, renderResumeHtml, resolveSections, themeFor } from "./templates.js";
import { DEFAULT_THEME, applyDensity, normalizeTheme, parseResumeContent } from "./theme.js";

afterAll(async () => { await closeSharedBrowser(); });

async function pdfText(pdf: Buffer): Promise<{ pages: number; text: string }> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const t = await (await doc.getPage(i)).getTextContent();
    text += " " + (t.items as { str: string }[]).map((x) => x.str).join(" ");
  }
  return { pages: doc.numPages, text: text.replace(/\s+/g, "").toLowerCase() };
}
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function allText(c: ResumeContent): string[] {
  return [
    c.name, c.summary ?? "",
    ...c.experience.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...c.education.map((e) => e.school),
    ...c.skills.flatMap((g) => g.items),
    ...(c.projects ?? []).flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...(c.certifications ?? []),
    ...(c.extras ?? []).flatMap((x) => [x.title, ...x.items]),
  ].filter(Boolean);
}

describe("template registry", () => {
  it("has seven templates, six ATS-safe and one flagged two-column", () => {
    expect(TEMPLATE_IDS).toHaveLength(7);
    expect(TEMPLATE_IDS.filter((id) => TEMPLATES[id].atsSafe)).toHaveLength(6);
    expect(TEMPLATES.sidebar).toMatchObject({ atsSafe: false, columns: 2 });
  });

  it("themeFor layers defaults, the template look and user overrides, and clamps bad input", () => {
    expect(themeFor("modern").font).toBe("inter");
    expect(themeFor("modern", { accent: "#ff0000", fontSize: 99, margin: -3, font: "nope" })).toMatchObject({ accent: "#ff0000", fontSize: 13, margin: 0.35, font: "inter" });
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ accent: "red" }).accent).toBe(DEFAULT_THEME.accent);
    const t = themeFor("classic");
    expect(applyDensity(t, "tight").fontSize).toBeLessThan(applyDensity(t, "compact").fontSize);
    expect(applyDensity(t, "compact").fontSize).toBeLessThan(t.fontSize);
  });
});

describe.each(TEMPLATE_IDS)("template %s", (id) => {
  it.each(Object.entries(SAMPLE_PERSONAS))("renders the %s persona as escaped, complete HTML", (_name, persona) => {
    const html = renderResumeHtml(persona, id);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<h1>");
    expect(html).not.toMatch(/<table|<img|<svg|<script/i);
    // text appears escaped, never as raw markup
    expect(html).not.toContain("<data>");
    for (const t of allText(persona)) {
      const escaped = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      expect(html, `missing "${t.slice(0, 40)}"`).toContain(escaped);
    }
  });

  it("passes the ATS layout and heading checks when it claims to be ATS-safe", () => {
    const html = renderResumeHtml(SAMPLE_RESUME, id);
    const r = atsChecks(SAMPLE_RESUME, html, null, 1);
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
    expect(byId.headings).toBe(true);
    expect(byId.layout).toBe(TEMPLATES[id].atsSafe);
  });

  it("prints every word of every persona onto real PDF text, within the page target", async () => {
    for (const [name, persona] of Object.entries(SAMPLE_PERSONAS)) {
      const r = await renderResume(persona, { templateId: id, maxPages: 3, trim: false });
      const { pages, text } = await pdfText(r.pdf);
      expect(pages, `${id}/${name}`).toBeLessThanOrEqual(3);
      expect(r.pages).toBe(pages);
      for (const t of allText(persona)) {
        expect(text, `${id}/${name} lost: "${t.slice(0, 50)}"`).toContain(squash(t));
      }
    }
  }, 120_000);

  it("fits a typical resume on one page at normal density", async () => {
    const r = await renderResume(SAMPLE_RESUME, { templateId: id });
    expect(r.pages).toBe(1);
    expect(r.density).toBe("normal");
    expect(r.html).toContain("/api/resume-fonts/");
  }, 60_000);
});

describe("page size and fitting", () => {
  it("renders A4 with the A4 page rule and still fits", async () => {
    const r = await renderResume(SAMPLE_RESUME, { templateId: "classic", theme: { pageSize: "a4" } });
    expect(r.html).toMatch(/@page \{ size: A4;/);
    expect(r.pages).toBe(1);
  }, 60_000);

  it("never drops content unless asked to trim", async () => {
    const long = SAMPLE_PERSONAS.long;
    const kept = await renderResume(long, { templateId: "classic", maxPages: 1, trim: false });
    expect(kept.content.experience).toHaveLength(long.experience.length);
    expect(kept.pages).toBeGreaterThan(1);
    const trimmed = await renderResume(long, { templateId: "classic", maxPages: 1, trim: true });
    expect(trimmed.pages).toBe(1);
    expect(trimmed.steps.some((s) => s.startsWith("drop:") || s.startsWith("trim:"))).toBe(true);
  }, 120_000);

  it("honours a two-page target for long careers", async () => {
    const r = await renderResume(SAMPLE_PERSONAS.long, { templateId: "modern", theme: { pages: 2 }, trim: false });
    expect(r.pages).toBeLessThanOrEqual(2);
    expect(r.atsChecks.find((c) => c.id === "one_page")).toMatchObject({ pass: true, label: "Fits within 2 pages" });
  }, 60_000);
});

describe("sections", () => {
  it("follows the resume's own order, hides sections, and keeps extras last", () => {
    const c: ResumeContent = { ...STUDENT_RESUME, layout: { sections: ["education", "skills", "experience"], hidden: ["projects"] } };
    const ids = resolveSections(c, TEMPLATES.classic).map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(["education", "skills", "experience"]);
    expect(ids).not.toContain("projects");
    expect(ids[ids.length - 1]).toBe("awards");
  });

  it("uses the template's preferred order when the resume sets none", () => {
    const ids = resolveSections(SAMPLE_RESUME, TEMPLATES.technical).map((s) => s.id);
    expect(ids.indexOf("skills")).toBeLessThan(ids.indexOf("experience"));
  });

  it("omits empty sections", () => {
    const ids = resolveSections({ ...SAMPLE_RESUME, summary: "", certifications: [], projects: [] }, TEMPLATES.classic).map((s) => s.id);
    expect(ids).toEqual(["experience", "education", "skills"]);
  });
});

describe("fonts", () => {
  it("every registered font has files and valid @font-face rules", () => {
    for (const id of FONT_IDS) {
      expect(fontFiles(id).length, id).toBeGreaterThan(0);
      for (const f of fontFiles(id)) expect(readFontFile(f.file)?.length ?? 0, f.file).toBeGreaterThan(1000);
    }
    const css = fontFaceCss(["inter", "inter", "lora"], "/api/resume-fonts/");
    expect(css).toContain("src:url(/api/resume-fonts/inter-latin-400-normal.woff2)");
    expect(css.match(/inter-latin-400-normal/g)).toHaveLength(1);
    expect(css).toContain("unicode-range");
  });

  it("refuses anything that is not a registered font file name", () => {
    for (const bad of ["../package.json", "..%2Fx.woff2", "inter-latin-400-normal.woff2/../../x", "/etc/passwd", "inter.woff2", "x-latin-400-normal.woff2", ""]) {
      expect(readFontFile(bad), bad).toBeNull();
    }
  });
});

describe("parseResumeContent", () => {
  it("assigns stable bullet ids, trims, and drops empty rows", () => {
    const r = parseResumeContent({
      name: "  Sam  ", contact: { email: " sam@x.io ", phone: "" },
      experience: [{ title: "Dev", company: "Co", bullets: [{ text: "  Built things  " }, { text: "   " }, { id: "keep", text: "Kept id" }, { id: "keep", text: "Dup id" }] }, { title: "", company: "", bullets: [] }],
      education: [{ school: "" }], skills: [{ group: "Langs", items: ["Go", " ", "Rust"] }, { group: "", items: ["x"] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.name).toBe("Sam");
    expect(r.content.contact).toEqual({ email: "sam@x.io" });
    expect(r.content.experience).toHaveLength(1);
    const ids = r.content.experience[0].bullets.map((b) => b.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe("keep");
    expect(r.content.skills).toEqual([{ group: "Langs", items: ["Go", "Rust"] }]);
    expect(r.content.education).toEqual([]);
  });

  it("rejects oversize text and unknown extra sections with a readable message", () => {
    const tooLong = parseResumeContent({ name: "x".repeat(500), contact: {}, experience: [], education: [], skills: [] });
    expect(tooLong.ok).toBe(false);
    const extra = parseResumeContent({ name: "A", contact: {}, experience: [], education: [], skills: [], extras: [{ title: "My Secret Section", items: ["x"] }] });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error).toMatch(/extras/);
    expect(parseResumeContent("nonsense").ok).toBe(false);
  });
});
