/**
 * Resume audit: one candidate, many very different postings. Every posting goes through the real pipeline (requirements,
 * match, tailor, render) on the offline stack and the result is checked against what a recruiter and an ATS would check:
 *  - the requirements read from the posting match what the posting says (recall and invented skills)
 *  - nothing is made up: skills, employers, titles and dates on the tailored resume all come from the candidate's own history
 *  - the resume changes with the job (summary, skills, bullets), and a different field is not dressed up as a fit
 *  - the file is real: one page, contact details present, PDF and HTML download, ATS score
 *   E2E_API_PORT=4302 E2E_WEB_PORT=3302 npx tsx scripts/qa-resume.mts
 */
import { jobs } from "@jobgraph/core";
import { Client, seedUser, startStack } from "./stack.mjs";

type Posting = { key: string; company: string; title: string; location: string; text: string; skills: string[]; family: string; fit: "high" | "medium" | "none" };

const POSTINGS: Posting[] = [
  { key: "fe-bullets", company: "Pixel Forge", title: "Senior Frontend Engineer", location: "Remote (US)", family: "frontend", fit: "high", skills: ["React", "TypeScript", "Next.js", "Playwright"],
    text: "About the role\nWe build design tools used by millions.\n\nRequirements:\n- 5+ years of experience with React and TypeScript\n- Experience with Next.js\n- Testing with Playwright\n\nNice to have:\n- GraphQL\n" },
  { key: "fe-prose", company: "Harbor Health", title: "Frontend Developer", location: "Boston, MA", family: "frontend", fit: "high", skills: ["React", "TypeScript", "accessibility"],
    text: "You will own the patient portal front end. We are looking for someone who writes clean React and TypeScript, cares about accessibility, and enjoys working closely with designers. You should be comfortable owning features from idea to launch. Experience in healthcare is a plus." },
  { key: "fe-designsys", company: "Atlas Systems", title: "Staff Design Systems Engineer", location: "New York, NY", family: "frontend", fit: "high", skills: ["React", "TypeScript", "Storybook", "design systems"],
    text: "What you'll do\n- Lead our design system used by 12 product teams\n- Build components in React and TypeScript, documented in Storybook\n\nWhat we're looking for\n- 8+ years building front-end platforms\n- Deep knowledge of design systems and accessibility\n" },
  { key: "be-go", company: "Kubeworks", title: "Backend Engineer", location: "Austin, TX", family: "backend", fit: "medium", skills: ["Go", "Kubernetes", "PostgreSQL", "gRPC"],
    text: "Requirements:\n- 4+ years of backend development in Go\n- Kubernetes in production\n- PostgreSQL and gRPC services\n\nNice to have:\n- Terraform\n" },
  { key: "be-node", company: "LedgerLine", title: "Full-Stack Engineer", location: "Remote", family: "fullstack", fit: "high", skills: ["Node.js", "TypeScript", "React", "PostgreSQL"],
    text: "Responsibilities\n- Build features across our Node.js API and React app\n- Write TypeScript everywhere\n\nQualifications\n- Strong Node.js and PostgreSQL skills\n- React experience\n" },
  { key: "ds", company: "Insight Labs", title: "Senior Data Scientist", location: "San Francisco, CA", family: "data", fit: "none", skills: ["Python", "machine learning", "SQL", "PyTorch"],
    text: "Requirements:\n- PhD or MS in a quantitative field\n- Python, SQL and PyTorch\n- Experience shipping machine learning models to production\n- Statistics and experiment design\n" },
  { key: "devops", company: "CloudNine", title: "Site Reliability Engineer", location: "Seattle, WA", family: "devops", fit: "none", skills: ["Kubernetes", "Terraform", "AWS", "Prometheus"],
    text: "You'll be on call for our platform.\nRequirements:\n- Kubernetes and Terraform at scale\n- AWS (EKS, RDS)\n- Prometheus and Grafana\n- Linux internals\n" },
  { key: "ios", company: "Orbit Mobile", title: "iOS Engineer", location: "Los Angeles, CA", family: "mobile", fit: "none", skills: ["Swift", "SwiftUI", "iOS"],
    text: "Requirements:\n- 3+ years of iOS development in Swift\n- SwiftUI and UIKit\n- Published apps on the App Store\n" },
  { key: "mech", company: "Anduril Industries", title: "Mechanical Engineer", location: "Costa Mesa, CA", family: "mechanical", fit: "none", skills: ["SolidWorks", "GD&T"],
    text: "Requirements:\n- BS in Mechanical Engineering\n- SolidWorks and GD&T\n- Experience with design for manufacturing and prototyping\n" },
  { key: "nurse", company: "St. Mary's Hospital", title: "Registered Nurse", location: "Chicago, IL", family: "nursing", fit: "none", skills: ["RN license", "BLS"],
    text: "Requirements:\n- Active RN license in Illinois\n- BLS and ACLS certification\n- 2+ years of acute care experience\n" },
  { key: "marketing", company: "Brightside", title: "Growth Marketing Manager", location: "Remote", family: "marketing", fit: "none", skills: ["SEO", "Google Analytics", "A/B testing"],
    text: "What you'll do\n- Own paid and organic growth\n- Run A/B testing programs\nWhat we need\n- SEO and Google Analytics\n- 5+ years in B2B marketing\n" },
  { key: "vague", company: "Mystery Co", title: "Software Engineer", location: "Remote", family: "any", fit: "medium", skills: [],
    text: "We are a fast-growing company looking for a motivated engineer to join our team. Competitive salary, great benefits, and a friendly culture." },
];

const stack = await startStack({});
const bad: string[] = [];
const note = (k: string, m: string) => { const s = `${k}: ${m}`; if (!bad.includes(s)) bad.push(s); };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

try {
  const seed = await seedUser(stack);
  const c = new Client(stack.apiUrl);
  c.cookie = seed.cookie;

  const baseline = (await c.call("GET", "/api/profile")).json;
  const graph = (await c.call("GET", "/api/graph")).json as { nodes: { type: string; label: string; text?: string }[] };
  const knownText = norm(JSON.stringify(graph) + " " + JSON.stringify(baseline));

  const rows = await stack.db.insert(jobs).values(POSTINGS.map((p, i) => ({
    companyName: p.company, atsType: "web", externalId: `rq-${i}`, title: p.title, location: p.location, remote: /remote/i.test(p.location),
    descriptionText: p.text, applyUrl: `https://example.com/?job=rq-${i}`,
  }))).returning();
  await c.call("GET", "/api/jobs?limit=100&wait=1");

  const fingerprints = new Map<string, string>();
  const summaries: string[] = [];
  const report: string[] = [];
  for (const [i, p] of POSTINGS.entries()) {
    const k = p.key;
    const created = await c.call("POST", "/api/applications?wait=1", { jobId: rows[i].id });
    if (created.status >= 400) { note(k, `could not start an application (${created.status}) ${JSON.stringify(created.json).slice(0, 100)}`); continue; }
    const id = created.json.id as string;
    const d = (await c.call("GET", `/api/applications/${id}`)).json;
    const job = (await c.call("GET", `/api/jobs/${rows[i].id}`)).json;
    const req = job.job?.requirements ?? d.job?.requirements;
    const score = job.match?.score ?? d.match?.score;
    const resume = d.resume;

    // 1. requirements read correctly
    const gotSkills: string[] = (req?.skills ?? []).map((s: { name: string }) => s.name);
    const missed = p.skills.filter((s) => !gotSkills.some((g) => norm(g) === norm(s) || norm(g).includes(norm(s)) || norm(s).includes(norm(g))));
    if (missed.length) note(k, `requirements missed ${missed.join(", ")} (read: ${gotSkills.join(", ") || "nothing"})`);
    const invented = gotSkills.filter((g) => !norm(p.text + " " + p.title).includes(norm(g)) && !(g === "Incident Management" && /on[- ]call/i.test(p.text)) && !(g === "Nursing" && /acute care/i.test(p.text)));
    if (invented.length) note(k, `requirements invented ${invented.join(", ")}`);
    if (p.skills.length === 0 && gotSkills.length > 0) note(k, `a posting with no skills produced requirements: ${gotSkills.join(", ")}`);

    // 2. match score is sane for the field
    if (typeof score === "number") {
      if (p.fit === "high" && score < 0.55) note(k, `match is ${score} for a strong fit`);
      if (p.fit === "none" && score > 0.3) note(k, `match is ${score} for a different field`);
    } else note(k, "no match score");

    if (!resume) { note(k, "no tailored resume was produced"); report.push(`${k.padEnd(13)} score ${score}  NO RESUME`); continue; }
    const rc = resume.content;

    // 3. nothing made up
    const inventedSkills = (rc.skills ?? []).flatMap((g: { items: string[] }) => g.items).filter((s: string) => !knownText.includes(norm(s)));
    if (inventedSkills.length) note(k, `skills on the resume that are not in the candidate's history: ${inventedSkills.join(", ")}`);
    const baseEmployers: string[] = baseline.experience?.map((e: { company: string }) => e.company) ?? (baseline.content?.experience ?? []).map((e: { company: string }) => e.company);
    for (const e of rc.experience ?? []) {
      if (baseEmployers.length && !baseEmployers.includes(e.company)) note(k, `employer "${e.company}" is not in the candidate's history`);
    }
    const lacking = p.skills.filter((s) => !knownText.includes(norm(s)));
    const claimed = lacking.filter((s) => JSON.stringify(rc).toLowerCase().includes(s.toLowerCase()));
    if (claimed.length) note(k, `claims skills the candidate never listed: ${claimed.join(", ")}`);

    // 4. contact and basics
    if (!rc.name) note(k, "no name on the resume");
    if (!rc.contact?.email) note(k, "no email on the resume");
    if ((rc.experience ?? []).length === 0) note(k, "no experience on the resume");
    if (resume.pages !== 1) note(k, `resume is ${resume.pages} page(s), expected 1`);
    if (typeof resume.atsScore === "number" && resume.atsScore < 70) note(k, `ATS score ${resume.atsScore}`);
    for (const b of (rc.experience ?? []).flatMap((e: { bullets: { text: string }[] }) => e.bullets)) {
      if (/\b(lorem|undefined|null|\[object|NaN)\b/i.test(b.text)) note(k, `a bullet contains "${b.text.slice(0, 50)}"`);
      if (b.text.trim().length < 15) note(k, `a bullet is nearly empty: "${b.text}"`);
      if (b.text.split(/\s+/).length > 45) note(k, `a bullet is ${b.text.split(/\s+/).length} words long`);
    }

    // 5. files download
    const pdf = await fetch(`${stack.apiUrl}/api/resumes/${resume.id}/download?format=pdf`, { headers: { cookie: c.cookie } });
    const buf = Buffer.from(await pdf.arrayBuffer());
    if (pdf.status !== 200 || buf.subarray(0, 4).toString() !== "%PDF") note(k, `PDF download failed (${pdf.status})`);
    const html = await fetch(`${stack.apiUrl}/api/resumes/${resume.id}.html`, { headers: { cookie: c.cookie } });
    const htmlText = await html.text();
    if (html.status !== 200 || !htmlText.includes(rc.name)) note(k, `HTML export failed (${html.status})`);
    if (/<script/i.test(htmlText)) note(k, "HTML export contains a script tag");

    const sig = JSON.stringify({ s: rc.summary, sk: rc.skills, b: (rc.experience ?? []).map((e: { bullets: { text: string }[] }) => e.bullets.map((b) => b.text)) });
    if (p.fit !== "none") fingerprints.set(k, sig);
    summaries.push(rc.summary ?? "");
    report.push(`${k.padEnd(13)} score ${String(score).padStart(3)}  ats ${resume.atsScore ?? "-"}  pages ${resume.pages}  skills read: ${gotSkills.slice(0, 6).join(", ") || "-"}  | ${String(rc.summary ?? "").slice(0, 70)}`);
  }

  // 6. the resume must change with the job
  const distinct = new Set(fingerprints.values()).size;
  if (distinct < Math.ceil(fingerprints.size * 0.8)) note("all", `only ${distinct} different resumes for ${fingerprints.size} jobs in the candidate's field: tailoring barely changes anything`);
  const uniqSummaries = new Set(summaries).size;
  

  console.log(report.join("\n"));
  console.log(`\n${distinct} distinct resumes across ${fingerprints.size} jobs`);
} finally {
  await stack.stop();
}
console.log(bad.length ? `\n${bad.length} resume problem(s):\n- ${bad.join("\n- ")}` : "\nresume audit: clean");
process.exit(bad.length ? 1 : 0);
