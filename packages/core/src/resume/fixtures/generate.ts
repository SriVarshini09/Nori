/**
 * Regenerates the resume fixtures in this folder: `npx tsx packages/core/src/resume/fixtures/generate.ts`.
 * PDFs are printed by Chromium from HTML (so <a href> becomes real link annotations), the DOCX is built
 * with the `docx` package, and the scanned PDF is a screenshot embedded as an image (no text layer).
 * Outputs are committed so tests run offline without a browser.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import {
  AlignmentType, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #111; margin: 0; line-height: 1.35; }
  h1 { font-size: 22pt; margin: 0 0 4px; }
  h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #999; margin: 14px 0 6px; padding-bottom: 2px; }
  ul { margin: 2px 0 8px 0; padding-left: 18px; }
  li { margin: 1px 0; }
  a { color: #1a4fb5; text-decoration: none; }
  .row { display: flex; justify-content: space-between; font-weight: bold; margin-top: 6px; }
  .sub { font-style: italic; }
  .contact { font-size: 10pt; }
`;

async function pdf(browser: Browser, file: string, html: string) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${html}</body></html>`);
  await page.pdf({ path: path.join(DIR, file), format: "Letter", margin: { top: "0.5in", bottom: "0.5in", left: "0.6in", right: "0.6in" }, printBackground: true });
  await page.close();
}

// 1. single column, links hidden behind "LinkedIn" / "GitHub" / "Portfolio"
const ALEX = `
<h1>Alex Chen</h1>
<div class="contact">Seattle, WA &nbsp;·&nbsp; (206) 555-0142 &nbsp;·&nbsp; <a href="mailto:alex.chen@example.com">alex.chen@example.com</a> &nbsp;·&nbsp;
<a href="https://www.linkedin.com/in/alexchen-dev/">LinkedIn</a> &nbsp;·&nbsp; <a href="https://github.com/alexchendev">GitHub</a> &nbsp;·&nbsp; <a href="https://alexchen.dev/">Portfolio</a></div>
<h2>Summary</h2>
<p>Backend-leaning full-stack engineer with seven years building payments and data products.</p>
<h2>Experience</h2>
<div class="row"><span>Senior Software Engineer — Stripe</span><span>Jan 2021 – Present</span></div>
<ul>
<li>Led the redesign of the payouts ledger in Go and PostgreSQL, cutting reconciliation time by 60%</li>
<li>Built a Kafka-based event pipeline processing 40M events per day with exactly-once delivery</li>
<li>Mentored 5 engineers and ran the backend guild's design reviews</li>
</ul>
<div class="row"><span>Software Engineer — Zillow</span><span>Jun 2018 – Dec 2020</span></div>
<ul>
<li>Shipped a React and TypeScript listing editor used by 120,000 agents</li>
<li>Reduced AWS costs by 25% by moving batch jobs to Kubernetes CronJobs</li>
</ul>
<div class="row"><span>Software Engineering Intern — Microsoft</span><span>May 2017 – Aug 2017</span></div>
<ul><li>Prototyped a C# telemetry dashboard for the Azure DevOps team</li></ul>
<h2>Education</h2>
<p>B.S. Computer Science, University of Washington, 2018</p>
<h2>Skills</h2>
<p>Go, TypeScript, React, PostgreSQL, Kafka, Kubernetes, AWS, Terraform</p>
`;

// 2. two-column: sidebar (contact, skills, education) + main (summary, experience)
const SAMIRA = `
<style>
  .hdr { text-align: center; padding-bottom: 8px; border-bottom: 2px solid #333; }
  .hdr h1 { margin: 0; } .hdr .title { font-size: 12pt; color: #444; }
  .cols { display: grid; grid-template-columns: 2.1in 1fr; gap: 0.35in; margin-top: 8px; }
  .side { font-size: 9.5pt; }
  .side p { margin: 2px 0; }
</style>
<div class="hdr"><h1>Samira Haddad</h1><div class="title">Senior Data Engineer</div></div>
<div class="cols">
  <div class="side">
    <h2>Contact</h2>
    <p>samira.haddad@example.com</p>
    <p>+1 312 555 0187</p>
    <p>Chicago, IL</p>
    <p><a href="https://www.linkedin.com/in/samirahaddad">linkedin.com/in/samirahaddad</a></p>
    <p><a href="https://github.com/shaddad">github.com/shaddad</a></p>
    <h2>Skills</h2>
    <p>Python</p><p>SQL</p><p>Apache Spark</p><p>Kafka</p><p>Airflow</p><p>dbt</p><p>Snowflake</p><p>Tableau</p><p>AWS</p>
    <h2>Education</h2>
    <p>M.S. Computer Science</p>
    <p>University of Illinois</p>
    <p>2015</p>
    <h2>Languages</h2>
    <p>English, Arabic, French</p>
  </div>
  <div class="main">
    <h2>Summary</h2>
    <p>Data engineer who turns messy event streams into reliable, well-modelled warehouses that analysts trust.</p>
    <h2>Experience</h2>
    <div class="row"><span>Senior Data Engineer | Grubhub</span><span>Mar 2021 – Present</span></div>
    <ul>
      <li>Designed a Kafka streaming layer that moved order events into Snowflake in under 90 seconds end to end</li>
      <li>Cut warehouse spend 35% by rewriting the heaviest Spark jobs and adding incremental dbt models</li>
      <li>Owned on-call for the ingestion platform serving 14 product teams</li>
    </ul>
    <div class="row"><span>Data Engineer | Groupon</span><span>Jul 2017 – Feb 2021</span></div>
    <ul>
      <li>Migrated 300 cron scripts into Airflow DAGs with lineage, retries and SLA alerts</li>
      <li>Built the deal-performance mart used by 200 account managers every morning</li>
    </ul>
    <div class="row"><span>Business Intelligence Analyst | Morningstar</span><span>Jun 2015 – Jun 2017</span></div>
    <ul>
      <li>Published Tableau dashboards for fund flows that replaced a weekly 40-page PDF report</li>
      <li>Automated SQL quality checks on 60 vendor feeds</li>
    </ul>
  </div>
</div>
`;

// 5. "Work History", two-line headers, MM/YYYY dates
const KENJI = `
<h1>Kenji Watanabe</h1>
<div class="contact">Portland, OR | 503-555-0123 | kenji.watanabe@example.com | www.linkedin.com/in/kenjiwatanabe</div>
<h2>Work History</h2>
<div><b>Operations Manager</b></div>
<div class="sub">Columbia Sportswear | Portland, OR | 06/2019 - 02/2022</div>
<ul>
<li>Ran a 45-person distribution team shipping 18,000 orders per week</li>
<li>Introduced a WMS slotting plan that raised pick rates by 22%</li>
</ul>
<div><b>Logistics Coordinator</b></div>
<div class="sub">Nike | Beaverton, OR | 08/2016 - 05/2019</div>
<ul>
<li>Coordinated inbound freight with 30 carriers and cut detention fees by $140K a year</li>
</ul>
<div><b>Warehouse Associate</b></div>
<div class="sub">Fred Meyer | Portland, OR | 2014-2016</div>
<ul><li>Trained 12 new hires on forklift safety and cycle counting</li></ul>
<h2>Education</h2>
<p>B.A. Supply Chain Management, Portland State University, 2014</p>
<h2>Certifications</h2>
<p>APICS Certified Supply Chain Professional (CSCP), 2020</p>
`;

// 6. non-US: London, +44, LinkedIn behind a word on a country subdomain
const OLIVER = `
<h1>Oliver Bennett</h1>
<div class="contact">London, UK &nbsp;|&nbsp; +44 20 7946 0958 &nbsp;|&nbsp; oliver.bennett@example.co.uk &nbsp;|&nbsp; <a href="https://uk.linkedin.com/in/oliverbennett">LinkedIn</a> &nbsp;|&nbsp; https://github.com/obennett</div>
<h2>Professional Experience</h2>
<div class="row"><span>Lead Data Scientist, Monzo</span><span>Sep 2020 – Present</span></div>
<ul>
<li>Built gradient-boosted fraud models in Python that blocked £4M of card fraud a year</li>
<li>Set up the experimentation platform used for 150 A/B tests</li>
</ul>
<div class="row"><span>Data Scientist, Deliveroo</span><span>Jan 2017 – Aug 2020</span></div>
<ul>
<li>Forecast rider demand per zone with 92% accuracy using PyTorch</li>
</ul>
<h2>Education</h2>
<p>MSc Machine Learning — University College London, 2016</p>
<h2>Skills</h2>
<p>Python | PyTorch | SQL | Spark | Experimentation</p>
`;

// 8. scanned: the same kind of page, rasterised
const LENA = `
<div style="padding:40px">
<h1>Lena Fischer</h1>
<div class="contact">Berlin, Germany · +49 30 901820 · lena.fischer@example.de</div>
<h2>Experience</h2>
<div class="row"><span>Product Designer — N26</span><span>2019 – Present</span></div>
<ul><li>Redesigned onboarding, lifting activation by 18%</li></ul>
</div>`;

async function scanned(browser: Browser, file: string) {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  await page.setContent(`<!doctype html><html><head><style>${BASE_CSS}</style></head><body>${LENA}</body></html>`);
  const png = await page.screenshot({ type: "png" });
  await page.setContent(`<!doctype html><html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${png.toString("base64")}"></body></html>`);
  await page.pdf({ path: path.join(DIR, file), format: "Letter", margin: { top: "0", bottom: "0", left: "0", right: "0" } });
  await page.close();
}

// 3. DOCX with hyperlinks and a skills table
async function docx(file: string) {
  const link = (text: string, url: string) => new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink" })] });
  const sep = () => new TextRun("  |  ");
  const heading = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });
  const bullet = (t: string) => new Paragraph({ text: t, bullet: { level: 0 } });
  const cell = (t: string) => new TableCell({ children: [new Paragraph(t)], width: { size: 50, type: WidthType.PERCENTAGE } });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Maria Garcia", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun("Austin, Texas"), sep(), new TextRun("512.555.0199"), sep(), link("maria.garcia@example.com", "mailto:maria.garcia@example.com")],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [link("LinkedIn", "https://www.linkedin.com/in/mariagarcia"), sep(), link("GitHub", "https://github.com/mgarcia-codes"), sep(),
            link("Portfolio", "https://mariagarcia.design"), sep(), link("Dribbble", "https://dribbble.com/mariag")],
        }),
        heading("Profile"),
        new Paragraph("Product-minded frontend engineer who designs and ships accessible interfaces."),
        heading("Experience"),
        new Paragraph({ children: [new TextRun({ text: "Senior Frontend Engineer | Indeed | Mar 2020 – Present", bold: true })] }),
        bullet("Rebuilt the job-search results page in React and TypeScript, improving LCP by 1.2 seconds"),
        bullet("Led the WCAG 2.1 accessibility remediation across 40 pages"),
        new Paragraph({ children: [new TextRun({ text: "UI Developer | Whole Foods Market | Aug 2016 – Feb 2020", bold: true })] }),
        bullet("Built a Vue.js component library adopted by 6 product teams"),
        bullet("Cut CSS bundle size by 45% with a Sass design-token refactor"),
        heading("Skills"),
        new Table({
          rows: [
            new TableRow({ children: [cell("React, TypeScript, Vue.js"), cell("Figma, Storybook, Jest")] }),
            new TableRow({ children: [cell("HTML, CSS, Sass"), cell("Accessibility, Design Systems")] }),
          ],
        }),
        heading("Education"),
        new Paragraph("B.F.A. Graphic Design, The University of Texas at Austin, 2016"),
      ],
    }],
  });
  await writeFile(path.join(DIR, file), await Packer.toBuffer(doc));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await pdf(browser, "alex-chen-links.pdf", ALEX);
    await pdf(browser, "samira-two-column.pdf", SAMIRA);
    await pdf(browser, "kenji-work-history.pdf", KENJI);
    await pdf(browser, "oliver-london.pdf", OLIVER);
    await scanned(browser, "lena-scanned.pdf");
  } finally {
    await browser.close();
  }
  await docx("maria-garcia.docx");
  console.log("fixtures written to", DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
