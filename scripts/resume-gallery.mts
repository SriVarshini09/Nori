/**
 * Render every resume template with every sample persona to PNG (for human review) and report page counts and ATS scores.
 *   npx tsx scripts/resume-gallery.mts [templateId ...]
 * Output: test-results/resume-gallery/<template>-<persona>.png and .pdf, plus summary.md
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SAMPLE_PERSONAS, TEMPLATE_IDS, TEMPLATES, closeSharedBrowser, readFontFile, renderResume, renderResumeHtml, type TemplateId } from "@jobgraph/core";
import { ROOT } from "./stack.mjs";

const only = process.argv.slice(2) as TemplateId[];
const out = path.join(ROOT, "test-results/resume-gallery");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const ctx = await browser.newContext({ viewport: { width: 980, height: 1200 }, deviceScaleFactor: 1.5 });
await ctx.route("https://fonts.nori.invalid/**", (r) => {
  const body = readFontFile(decodeURIComponent(new URL(r.request().url()).pathname.slice(1)));
  return body ? r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body }) : r.fulfill({ status: 404, body: "" });
});
const rows: string[] = ["| Template | Persona | Pages | Fit steps | ATS |", "|---|---|---|---|---|"];
for (const id of TEMPLATE_IDS) {
  if (only.length && !only.includes(id)) continue;
  for (const [pname, content] of Object.entries(SAMPLE_PERSONAS)) {
    const r = await renderResume(content, { templateId: id, trim: false });
    await writeFile(path.join(out, `${id}-${pname}.pdf`), r.pdf);
    const page = await ctx.newPage();
    await page.setContent(renderResumeHtml(content, id, undefined, { fontBase: "https://fonts.nori.invalid", density: r.density }), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `${id}-${pname}.png`), fullPage: true });
    await page.close();
    rows.push(`| ${TEMPLATES[id].name} | ${pname} | ${r.pages} | ${r.steps.join(", ") || "-"} | ${r.atsScore} |`);
  }
}
await writeFile(path.join(out, "summary.md"), rows.join("\n") + "\n");
console.log(rows.join("\n"));
await browser.close();
await closeSharedBrowser();
process.exit(0);
