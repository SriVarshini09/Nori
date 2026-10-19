import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderPdf, pdfPagesOnDisk } from "./pdf.js";
import { longBaseline, sampleBaseline, sampleRequirements } from "./sample.fixture.js";

const outDir = path.resolve("data/artifacts/test");

describe("renderPdf", () => {
  it("renders a 3-role resume to one Letter page", async () => {
    const out = path.join(outDir, "resume.pdf");
    const r = await renderPdf(sampleBaseline, out, { requirements: sampleRequirements });
    expect(existsSync(out)).toBe(true);
    expect(r.pages).toBe(1);
    expect(await pdfPagesOnDisk(out)).toBe(1);
    expect(r.steps).toEqual([]);
    expect(r.density).toBe("normal");
    expect(r.html).toContain("<h1>Jordan Rivera</h1>");
    expect(r.atsChecks.find((c) => c.id === "one_page")?.pass).toBe(true);
    expect(r.atsScore).toBeGreaterThanOrEqual(80);
  }, 60_000);

  it("fits a long 6-role resume onto one page via the fitting loop", async () => {
    const out = path.join(outDir, "resume-long.pdf");
    const r = await renderPdf(longBaseline(), out, { requirements: sampleRequirements });
    expect(r.pages).toBe(1);
    expect(await pdfPagesOnDisk(out)).toBe(1);
    expect(r.steps.length).toBeGreaterThan(2);
    expect(r.steps.slice(0, 2)).toEqual(["density:compact", "density:tight"]);
    // the most recent role is never trimmed below 3 bullets or dropped
    expect(r.content.experience[0].company).toBe("Acme Payments");
    expect(r.content.experience[0].bullets.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
