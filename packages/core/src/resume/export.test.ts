import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { renderResumeDocx, renderResumeJson, renderResumeText, resumeFileBase } from "./export.js";
import { SAMPLE_PERSONAS, SAMPLE_RESUME, STUDENT_RESUME } from "./sample-content.js";
import { TEMPLATE_IDS } from "./templates.js";

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

describe("DOCX export", () => {
  it.each(TEMPLATE_IDS)("%s: a valid Word file that contains every word", async (id) => {
    for (const [name, persona] of Object.entries(SAMPLE_PERSONAS)) {
      const buf = await renderResumeDocx(persona, id);
      expect(buf.subarray(0, 2).toString()).toBe("PK"); // a zip
      const { value, messages } = await mammoth.extractRawText({ buffer: buf });
      expect(messages.filter((m) => m.type === "error"), `${id}/${name}`).toEqual([]);
      const text = squash(value);
      const all = [persona.name, ...persona.experience.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]), ...persona.education.map((e) => e.school), ...persona.skills.flatMap((g) => g.items), ...(persona.extras ?? []).flatMap((x) => x.items)];
      for (const t of all) expect(text, `${id}/${name} lost "${t.slice(0, 40)}"`).toContain(squash(t));
    }
  }, 60_000);

  it("keeps the section order and hides hidden sections", async () => {
    const c = { ...SAMPLE_RESUME, layout: { sections: ["skills", "experience", "education"] as ("skills" | "experience" | "education")[], hidden: ["projects" as const] } };
    const { value } = await mammoth.extractRawText({ buffer: await renderResumeDocx(c, "ats") });
    expect(value.indexOf("Skills")).toBeLessThan(value.indexOf("Experience"));
    expect(value.indexOf("Experience")).toBeLessThan(value.indexOf("Education"));
    expect(value).not.toContain("Open-source charts library");
  });

  it("falls back to Classic for an unknown template", async () => {
    expect((await renderResumeDocx(SAMPLE_RESUME, "wordart")).length).toBeGreaterThan(2000);
  });
});

describe("text and JSON export", () => {
  it("writes readable plain text with headings, dates and bullets", () => {
    const t = renderResumeText(SAMPLE_RESUME);
    expect(t.split("\n")[0]).toBe("Alex Morgan");
    expect(t).toContain("EXPERIENCE");
    expect(t).toContain("Senior Software Engineer, Northwind Labs  |  Mar 2022 – Present");
    expect(t).toContain("- Led the migration of the checkout flow");
    expect(t).toContain("Languages: TypeScript, Python, SQL, Go");
    expect(t).not.toMatch(/\n{3,}/);
    expect(renderResumeText(STUDENT_RESUME)).toContain("AWARDS\n- Dean's List, six semesters");
  });

  it("round-trips JSON", () => {
    const j = JSON.parse(renderResumeJson(SAMPLE_RESUME, "ats", { accent: "#112233" }));
    expect(j).toMatchObject({ format: "nori-resume", template: "ats", theme: { accent: "#112233" } });
    expect(j.content.name).toBe("Alex Morgan");
  });

  it("makes safe file names", () => {
    expect(resumeFileBase("Łukasz Żółkiewski-Núñez")).toBe("Lukasz-Zolkiewski-Nunez-Resume");
    expect(resumeFileBase("../../etc/passwd")).toBe("etc-passwd-Resume");
    expect(resumeFileBase("")).toBe("My-Resume");
    expect(resumeFileBase("x".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});
