/**
 * Mock data for development without the API (NEXT_PUBLIC_USE_MOCK=1, the default).
 * Shapes follow ARCHITECTURE.md / schema.ts. Mutating endpoints just return plausible results;
 * client components keep their own optimistic state.
 */
import type {
  AgentActivity, AgentStatus, AgentTickSummary, Application, ApplicationDetail, ApplicationListItem, ApplicationStatus, AtsCheck, Channel, Company,
  Graph, GraphEdge, GraphNode, InboxMessage, Integration, Job, JobDetail, JobWithMatch, Lane, Match, Me, ModelMode, ModelSettings, ModelSettingsInput, ModelTestResult,
  IngestResult, OnboardingState, Resume, ResumeChange, ResumeContent, RunEventRow, TrackerStats,
} from "./types";

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

// ---------------------------------------------------------------- me
export const me: Me = {
  user: { id: "u1", email: "alex.chen@example.com", name: "Alex Chen", createdAt: ago(60 * 24 * 40) },
  profile: {
    userId: "u1",
    fullName: "Alex Chen",
    email: "alex.chen@example.com",
    phone: "+1 415 555 0134",
    linkedin: "https://linkedin.com/in/alexchen",
    website: "https://alexchen.dev",
    location: "San Francisco, CA",
    workAuth: { authorizedUS: true, needsSponsorship: false, notes: "US citizen" },
    preferences: {
      titles: ["Senior Frontend Engineer", "Staff Software Engineer", "Full-Stack Engineer"],
      locations: ["San Francisco", "New York", "Remote (US)"],
      remote: "ok",
      salaryMin: 180000,
      stages: ["Series A", "Series B", "Series C"],
      excludeCompanies: [],
    },
    resumeAutoApprove: false,
    reviewBeforeSubmit: true,
    autoApplyDailyCap: 0,
    autoApplyMinScore: 0.75,
    updatedAt: ago(300),
    city: "San Francisco",
    state: "CA",
    country: "United States",
    github: "https://github.com/alexchen",
    pronouns: null,
    willingToRelocate: false,
    remotePreference: "hybrid",
    heardAbout: "Job board",
    salaryExpectation: { amount: 195000, currency: "USD", period: "year" },
    earliestStartDate: null,
    noticePeriodWeeks: 2,
    eeo: { gender: "decline", race: "decline", veteran: "decline", disability: "decline" },
    securityClearance: "none",
    over18: true,
    onboarding: { step: "done", completedAt: ago(60 * 24 * 39) },
  },
};

// ---------------------------------------------------------------- graph
function node(id: string, type: string, label: string, props: Record<string, unknown> = {}, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, type, label, props, source: "resume", sourceQuote: null, startDate: null, endDate: null, ...extra };
}
const nodes: GraphNode[] = [
  node("n-r1", "role", "Senior Frontend Engineer, Lumen Analytics", { title: "Senior Frontend Engineer", employmentType: "full-time" },
    { startDate: "2022-03", endDate: null, sourceQuote: "Senior Frontend Engineer, Lumen Analytics (Mar 2022 - Present)" }),
  node("n-r2", "role", "Software Engineer, Brightpath", { title: "Software Engineer", employmentType: "full-time" },
    { startDate: "2019-06", endDate: "2022-02", sourceQuote: "Software Engineer, Brightpath (Jun 2019 - Feb 2022)" }),
  node("n-c1", "company", "Lumen Analytics", { industry: "Analytics SaaS" }),
  node("n-c2", "company", "Brightpath", { industry: "EdTech" }),
  node("n-c3", "company", "UT Austin", { industry: "University" }),
  node("n-p1", "project", "Realtime dashboard rewrite", { summary: "Rebuilt the core dashboard on React + streaming GraphQL" }, { source: "chat", sourceQuote: "I led the dashboard rewrite last year" }),
  node("n-p2", "project", "Design system (Lumen UI)", { summary: "Shared component library, WCAG AA" }),
  node("n-s1", "skill", "React", { level: "expert", years: 7 }),
  node("n-s2", "skill", "TypeScript", { level: "expert", years: 6 }),
  node("n-s3", "skill", "Next.js", { level: "advanced", years: 4 }),
  node("n-s4", "skill", "GraphQL", { level: "advanced", years: 4 }),
  node("n-s5", "skill", "Node.js", { level: "advanced", years: 5 }),
  node("n-s6", "skill", "Web performance", { level: "advanced", years: 4 }),
  node("n-s7", "skill", "Accessibility", { level: "advanced", years: 3 }),
  node("n-t1", "tool", "Playwright", {}),
  node("n-t2", "tool", "Datadog RUM", {}),
  node("n-m1", "metric", "p95 load 4.2s to 1.1s", { value: 74, unit: "%", statement: "Cut p95 dashboard load time from 4.2s to 1.1s" }),
  node("n-m2", "metric", "+38% weekly active dashboards", { value: 38, unit: "%", statement: "Grew weekly active dashboards by 38%" }),
  node("n-m3", "metric", "CI time -45%", { value: 45, unit: "%", statement: "Reduced CI time by 45% by parallelising Playwright suites" }, { source: "chat", sourceQuote: "we cut CI by almost half" }),
  node("n-e1", "education", "BS Computer Science, UT Austin", { degree: "BS", field: "Computer Science" }, { startDate: "2015", endDate: "2019" }),
];
function edge(src: string, type: string, dst: string): GraphEdge {
  return { id: `e-${src}-${type}-${dst}`, src, dst, type };
}
const edges: GraphEdge[] = [
  edge("n-r1", "worked_at", "n-c1"), edge("n-r2", "worked_at", "n-c2"),
  edge("n-p1", "part_of", "n-r1"), edge("n-p2", "part_of", "n-r1"),
  edge("n-r1", "used", "n-s1"), edge("n-r1", "used", "n-s2"), edge("n-r1", "used", "n-s3"), edge("n-r1", "used", "n-s4"),
  edge("n-r2", "used", "n-s1"), edge("n-r2", "used", "n-s2"), edge("n-r2", "used", "n-s5"),
  edge("n-p1", "used", "n-s1"), edge("n-p1", "used", "n-s2"), edge("n-p1", "used", "n-s4"), edge("n-p1", "used", "n-s6"),
  edge("n-p2", "used", "n-s1"), edge("n-p2", "used", "n-s7"),
  edge("n-r1", "used", "n-t2"), edge("n-r2", "used", "n-t1"), edge("n-r1", "used", "n-t1"),
  edge("n-r1", "achieved", "n-m1"), edge("n-r1", "achieved", "n-m2"), edge("n-p1", "achieved", "n-m1"), edge("n-r2", "achieved", "n-m3"),
  edge("n-e1", "studied_at", "n-c3"),
];
export const graph: Graph = { nodes, edges };

// ---------------------------------------------------------------- jobs
type JobSeed = {
  id: string; company: string; title: string; location: string; remote: boolean; score: number;
  skills: [string, boolean][]; seniority: string; postedMin: number; ats: string; appStatus?: ApplicationStatus;
  blurb: string;
};

const seeds: JobSeed[] = [
  { id: "j1", company: "Corvid AI", title: "Senior Frontend Engineer", location: "Remote (US)", remote: true, score: 0.91,
    skills: [["React", true], ["TypeScript", true], ["Web performance", true], ["GraphQL", false], ["Accessibility", false]], seniority: "senior", postedMin: 180, ats: "greenhouse",
    blurb: "Build the interface for an AI research assistant used by analysts at thousands of companies." },
  { id: "j2", company: "Helix Payments", title: "Staff Software Engineer, Web Platform", location: "San Francisco, CA", remote: false, score: 0.84,
    skills: [["TypeScript", true], ["React", true], ["Node.js", true], ["Kubernetes", false]], seniority: "staff", postedMin: 60 * 20, ats: "lever",
    blurb: "Own the web platform that powers checkout widgets embedded across 40,000 merchants." },
  { id: "j3", company: "Tidewater", title: "Frontend Engineer, Design Systems", location: "Remote (US)", remote: true, score: 0.88,
    skills: [["React", true], ["Accessibility", true], ["TypeScript", true], ["Figma", false]], seniority: "senior", postedMin: 60 * 30, ats: "ashby",
    blurb: "Grow a design system used by six product teams and shape how we ship accessible UI." },
  { id: "j4", company: "Orbital Health", title: "Full-Stack Engineer", location: "New York, NY", remote: true, score: 0.78,
    skills: [["TypeScript", true], ["Node.js", true], ["PostgreSQL", true], ["React", false], ["HIPAA", false]], seniority: "mid", postedMin: 60 * 52, ats: "greenhouse",
    blurb: "Help clinics schedule, document and bill faster with a modern full-stack product." },
  { id: "j5", company: "Meridian Data", title: "Senior Frontend Engineer, Data Visualization", location: "Boston, MA", remote: false, score: 0.86,
    skills: [["React", true], ["TypeScript", true], ["D3", true], ["Web performance", false]], seniority: "senior", postedMin: 60 * 72, ats: "greenhouse", appStatus: "submitted",
    blurb: "Design and build interactive charts and exploration tools for large analytic datasets." },
  { id: "j6", company: "Kestrel Robotics", title: "Senior Software Engineer, Fleet UI", location: "Seattle, WA", remote: false, score: 0.73,
    skills: [["React", true], ["TypeScript", true], ["WebSockets", true], ["Three.js", false]], seniority: "senior", postedMin: 60 * 90, ats: "lever",
    blurb: "Real-time operator tooling for fleets of warehouse robots." },
  { id: "j7", company: "Parcel", title: "Senior Product Engineer", location: "Remote (Global)", remote: true, score: 0.69,
    skills: [["TypeScript", true], ["React", true], ["Next.js", false], ["Stripe", false]], seniority: "senior", postedMin: 60 * 120, ats: "ashby",
    blurb: "Own features end to end at a 25-person logistics software company." },
  { id: "j8", company: "Fieldnote", title: "Engineering Manager, Web", location: "Austin, TX", remote: false, score: 0.52,
    skills: [["People management", true], ["React", false], ["Hiring", true]], seniority: "lead", postedMin: 60 * 200, ats: "smartrecruiters",
    blurb: "Lead a team of six engineers building a collaborative note-taking product." },
  { id: "j9", company: "Northpoint", title: "Senior Frontend Engineer, Growth", location: "Remote (US)", remote: true, score: 0.89,
    skills: [["React", true], ["TypeScript", true], ["Next.js", true], ["Web performance", false], ["Playwright", false]], seniority: "senior", postedMin: 60 * 6, ats: "greenhouse",
    blurb: "Run experiments on the signup and onboarding funnel for a developer tools company." },
  { id: "j10", company: "Quarry", title: "Staff Frontend Engineer", location: "New York, NY", remote: true, score: 0.82,
    skills: [["React", true], ["TypeScript", true], ["GraphQL", true], ["Accessibility", false]], seniority: "staff", postedMin: 60 * 14, ats: "ashby",
    blurb: "Set technical direction for the web client of a data catalog used by 2,000 teams." },
  { id: "j11", company: "Sundial", title: "Software Engineer, Web", location: "Remote (Global)", remote: true, score: 0.76,
    skills: [["TypeScript", true], ["Node.js", true], ["React", false], ["Datadog RUM", false]], seniority: "mid", postedMin: 60 * 40, ats: "lever",
    blurb: "Build scheduling and calendar surfaces for a time-management startup." },
  { id: "j12", company: "Beacon Labs", title: "Senior Engineer, Developer Experience", location: "San Francisco, CA", remote: false, score: 0.71,
    skills: [["TypeScript", true], ["Playwright", true], ["Node.js", true], ["Rust", false]], seniority: "senior", postedMin: 60 * 55, ats: "greenhouse",
    blurb: "Make the internal build, test and release tooling fast and delightful." },
];

const companies: Company[] = seeds.map((s, i) => ({
  id: `co${i + 1}`, name: s.company, domain: `${s.company.toLowerCase().replace(/\s+/g, "")}.com`, atsType: s.ats,
  atsToken: s.company.toLowerCase().replace(/\s+/g, ""),
  research: i === 0
    ? {
        summary: "Corvid AI builds an AI research assistant for analysts. Series B, growing quickly with strong enterprise traction and a design-led engineering culture.",
        stage: "Series B", funding: "$62M total (Series B, 2025)", headcount: "~140", recentNews: ["Launched Corvid Teams in September", "Named to a 2026 enterprise AI shortlist"],
        interviewProcess: "Recruiter screen, take-home (3h), onsite with 4 sessions including system design.",
        sponsorshipSignals: "Has sponsored H-1B for senior engineers in the past year.",
        citations: [
          { field: "funding", url: "https://news.example.com/corvid-series-b", title: "Corvid AI raises $40M Series B" },
          { field: "headcount", url: "https://linkedin.example.com/company/corvid-ai", title: "Corvid AI on LinkedIn" },
          { field: "interviewProcess", url: "https://glassdoor.example.com/corvid-ai/interviews", title: "Corvid AI interview reviews" },
        ],
      }
    : null,
  researchedAt: i === 0 ? ago(60 * 5) : null,
}));

function buildJob(s: JobSeed): Job {
  const must = s.skills.filter(([, r]) => r).map(([n]) => n);
  const nice = s.skills.filter(([, r]) => !r).map(([n]) => n);
  const description = [
    `${s.company} is hiring a ${s.title}.`,
    "",
    s.blurb,
    "",
    "What you will do",
    "- Ship user-facing features from design to production with a small, senior team",
    "- Improve performance, reliability and accessibility of our core surfaces",
    "- Mentor engineers and raise the bar on code review and testing",
    "",
    "What we are looking for",
    ...must.map((m) => `- Strong experience with ${m}`),
    ...nice.map((m) => `- Nice to have: ${m}`),
    "",
    `Location: ${s.location}. Compensation $170k - $230k plus equity.`,
  ].join("\n");
  return {
    id: s.id, companyId: companies.find((c) => c.name === s.company)!.id, companyName: s.company, atsType: s.ats,
    externalId: `ext-${s.id}`, title: s.title, location: s.location, remote: s.remote,
    descriptionText: description, applyUrl: `https://boards.example.com/${s.company.toLowerCase().replace(/\s+/g, "")}/jobs/${s.id}`,
    postedAt: ago(s.postedMin), discoveredVia: s.id === "j7" ? "parallel_search" : "feed", firstSeenAt: ago(s.postedMin), lastSeenAt: ago(30), closedAt: null,
    requirements: {
      skills: s.skills.map(([name, required]) => ({ name, required })),
      seniority: s.seniority, roleFamily: "software-engineering", yearsMin: s.seniority === "mid" ? 3 : 5,
      mustHaves: must.map((m) => `Hands-on ${m}`), niceToHaves: nice.map((m) => `Familiarity with ${m}`),
      disqualifiers: [], keywords: s.skills.map(([n]) => n), summary: s.blurb,
    },
  };
}

function buildMatch(s: JobSeed): Match {
  const matched: Match["explanation"]["matched"] = [];
  const missing: Match["explanation"]["missing"] = [];
  for (const [name, required] of s.skills) {
    const n = nodes.find((x) => x.label.toLowerCase() === name.toLowerCase() && (x.type === "skill" || x.type === "tool"));
    if (n) matched.push({ requirement: name, nodeId: n.id, label: n.label, required });
    else missing.push({ requirement: name, required });
  }
  const reasons = [
    `${matched.length} of ${s.skills.length} stated skills appear in your career graph`,
    "Seniority matches your current role (Senior Frontend Engineer at Lumen Analytics)",
  ];
  if (s.skills.some(([n]) => n === "Web performance")) reasons.push("Your metric 'p95 load 4.2s to 1.1s' is direct evidence for performance work");
  return { jobId: s.id, score: s.score, explanation: { matched, missing, reasons }, computedAt: ago(45) };
}

const jobs: Job[] = seeds.map(buildJob);
const jobsWithMatch: JobWithMatch[] = seeds.map((s, i) => ({ job: jobs[i], match: buildMatch(s), applicationStatus: s.appStatus ?? null }));

export function listJobs(params: { q?: string; limit?: number; minScore?: number; status?: string } = {}): JobWithMatch[] {
  let out = jobsWithMatch.slice();
  if (params.q) {
    const q = params.q.toLowerCase();
    out = out.filter(({ job }) => `${job.title} ${job.companyName} ${job.location ?? ""}`.toLowerCase().includes(q));
  }
  if (params.minScore != null) out = out.filter(({ match }) => (match?.score ?? 0) >= params.minScore!);
  if (params.status === "applied") out = out.filter((j) => j.applicationStatus);
  if (params.status === "new") out = out.filter((j) => !j.applicationStatus);
  out.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
  return out.slice(0, params.limit ?? 100);
}

export function getJob(id: string): JobDetail {
  const i = jobs.findIndex((j) => j.id === id);
  const idx = i >= 0 ? i : 0;
  return { job: jobs[idx], match: jobsWithMatch[idx].match, company: companies[idx] };
}

export function researchCompany(jobId: string): Company["research"] {
  const j = jobs.find((x) => x.id === jobId) ?? jobs[0];
  return {
    summary: `${j.companyName} is a growth-stage software company. Engineering is remote-friendly with a small senior team and a bias toward shipping weekly.`,
    stage: "Series A", funding: "$24M total", headcount: "~60",
    recentNews: [`${j.companyName} announced a new enterprise tier`],
    interviewProcess: "Recruiter call, technical screen, onsite loop.",
    sponsorshipSignals: "No public signals found.",
    citations: [
      { field: "funding", url: "https://news.example.com/funding", title: "Funding announcement" },
      { field: "summary", url: `https://${j.companyName.toLowerCase().replace(/\s+/g, "")}.com/about`, title: "About page" },
    ],
  };
}

// ---------------------------------------------------------------- resumes
function resumeFor(jobId: string, appId: string): Resume {
  const job = jobs.find((j) => j.id === jobId) ?? jobs[0];
  const content: ResumeContent = {
    name: "Alex Chen",
    contact: { email: me.profile.email!, phone: me.profile.phone!, location: me.profile.location!, linkedin: me.profile.linkedin!, website: me.profile.website! },
    summary: `Frontend engineer with 7 years building fast, accessible product UI in React and TypeScript. Targeting ${job.title} at ${job.companyName}.`,
    experience: [
      {
        title: "Senior Frontend Engineer", company: "Lumen Analytics", location: "Remote", start: "Mar 2022", end: "Present",
        bullets: [
          { id: "b1", text: "Cut p95 dashboard load time from 4.2s to 1.1s by moving to streaming GraphQL and route-level code splitting", nodeIds: ["n-m1", "n-p1", "n-s4"] },
          { id: "b2", text: "Led the rewrite of the realtime dashboard in React and TypeScript, growing weekly active dashboards by 38%", nodeIds: ["n-p1", "n-m2", "n-s1"] },
          { id: "b3", text: "Built Lumen UI, a WCAG AA design system adopted by five product teams", nodeIds: ["n-p2", "n-s7"] },
        ],
      },
      {
        title: "Software Engineer", company: "Brightpath", location: "Austin, TX", start: "Jun 2019", end: "Feb 2022",
        bullets: [
          { id: "b4", text: "Reduced CI time by 45% by parallelising Playwright suites", nodeIds: ["n-m3", "n-t1"] },
          { id: "b5", text: "Shipped Node.js services and React front ends for a learning platform serving 200k students", nodeIds: ["n-r2", "n-s5", "n-s1"] },
        ],
      },
    ],
    education: [{ school: "UT Austin", degree: "BS", field: "Computer Science", start: "2015", end: "2019" }],
    skills: [
      { group: "Languages", items: ["TypeScript", "JavaScript", "SQL"] },
      { group: "Frontend", items: ["React", "Next.js", "Accessibility", "Web performance"] },
      { group: "Backend", items: ["Node.js", "GraphQL", "PostgreSQL"] },
    ],
  };
  const changes: ResumeChange[] = [
    {
      bulletId: "b1",
      before: "Improved dashboard speed by migrating the data layer",
      after: content.experience[0].bullets[0].text,
      reason: `${job.companyName} lists web performance as a requirement; surfaced the measured metric and technique.`,
      nodeIds: ["n-m1", "n-p1", "n-s4"],
    },
    {
      bulletId: "b3",
      before: "Built a shared component library",
      after: content.experience[0].bullets[2].text,
      reason: "Job emphasises accessibility; added the WCAG AA claim, which comes from your Accessibility skill node.",
      nodeIds: ["n-p2", "n-s7"],
    },
    {
      bulletId: "b5",
      before: "Worked on full-stack features for an education product",
      after: content.experience[1].bullets[1].text,
      reason: "Adds Node.js and React keywords and the user-scale figure from your role node.",
      nodeIds: ["n-r2", "n-s5", "n-s1"],
    },
  ];
  const checks: AtsCheck[] = [
    { id: "one-page", label: "Fits on one page", pass: true, weight: 15 },
    { id: "text-layer", label: "Selectable text layer (no images of text)", pass: true, weight: 20 },
    { id: "headings", label: "Standard section headings", pass: true, weight: 15 },
    { id: "keywords", label: "Covers job keywords", pass: true, detail: "9 of 11 keywords present", weight: 25 },
    { id: "dates", label: "Consistent date format", pass: true, weight: 10 },
    { id: "contact", label: "Contact details parseable", pass: true, weight: 10 },
    { id: "tables", label: "No tables or multi-column layout", pass: appId !== "app-3", detail: appId !== "app-3" ? undefined : "Skills block uses two columns", weight: 5 },
  ];
  const provenance: Record<string, string[]> = {};
  for (const e of content.experience) for (const b of e.bullets) provenance[b.id] = b.nodeIds;
  return {
    id: `res-${appId}`, applicationId: appId, version: 1, content, provenance, changes, html: null, pages: 1,
    atsScore: appId === "app-3" ? 91 : 96, atsChecks: checks, keywordCoverage: 0.82, createdAt: ago(40),
  };
}

// ---------------------------------------------------------------- applications
type AppSeed = { id: string; jobId: string; status: ApplicationStatus; minutesAgo: number; hasResume: boolean };
const appSeeds: AppSeed[] = [
  { id: "app-1", jobId: "j1", status: "tailoring", minutesAgo: 4, hasResume: false },
  { id: "app-2", jobId: "j3", status: "resume_review", minutesAgo: 22, hasResume: true },
  { id: "app-3", jobId: "j2", status: "form_review", minutesAgo: 55, hasResume: true },
  { id: "app-4", jobId: "j5", status: "submitted", minutesAgo: 60 * 26, hasResume: true },
  { id: "app-5", jobId: "j4", status: "needs_user", minutesAgo: 60 * 3, hasResume: true },
  { id: "app-6", jobId: "j6", status: "failed", minutesAgo: 60 * 8, hasResume: true },
  { id: "app-7", jobId: "j7", status: "interview", minutesAgo: 60 * 24 * 4, hasResume: true },
  { id: "app-8", jobId: "j8", status: "queued", minutesAgo: 1, hasResume: false },
];

function buildApplication(seed: AppSeed): Application {
  const submitted = ["submitted", "interview", "viewed", "replied", "offer", "rejected"].includes(seed.status);
  const base: Application = {
    id: seed.id, userId: "u1", jobId: seed.jobId, status: seed.status, resumeId: seed.hasResume ? `res-${seed.id}` : null,
    answers: {}, pendingQuestions: [], receipt: null, error: null, attempts: seed.status === "failed" ? 2 : 1,
    resumeApprovedAt: ["form_review", "submitting", "awaiting_code"].includes(seed.status) || submitted ? ago(seed.minutesAgo - 5) : null,
    formApprovedAt: submitted ? ago(seed.minutesAgo - 2) : null,
    submittedAt: submitted ? ago(seed.minutesAgo - 3) : null,
    createdAt: ago(seed.minutesAgo + 10), updatedAt: ago(Math.max(1, seed.minutesAgo - 1)),
  };
  if (seed.status === "form_review" || seed.status === "needs_user" || submitted || seed.status === "failed") {
    base.answers = {
      "Full name": "Alex Chen",
      "Email": "alex.chen@example.com",
      "Phone": "+1 415 555 0134",
      "LinkedIn profile": "https://linkedin.com/in/alexchen",
      "Are you legally authorized to work in the United States?": "Yes",
      "Will you now or in the future require sponsorship?": "No",
      "Why do you want to work here?": "I have spent the last three years making analytics dashboards fast and accessible, and your product sits right at that intersection.",
    };
  }
  if (seed.status === "needs_user" || seed.status === "form_review") {
    base.pendingQuestions = [
      { label: "Desired salary (USD)", type: "text", required: true },
      { label: "How did you hear about us?", type: "select", options: ["LinkedIn", "Referral", "Job board", "Other"], required: true },
    ];
  }
  if (seed.status === "failed") base.error = "Apply form changed: could not find the submit button (selector #submit_app). Screenshot saved.";
  if (submitted) {
    base.receipt = {
      fields: Object.entries(base.answers).map(([label, value]) => ({ label, value, kind: "text" })),
      files: ["Alex_Chen_Resume.pdf"], screenshotPath: `data/artifacts/${seed.id}/confirmation.png`,
      confirmationText: "Thank you for applying! Your application has been received and our team will review it shortly.",
      submittedVia: "greenhouse", dryRun: false, durationMs: 41_300,
    };
  }
  return base;
}

const applications: Application[] = appSeeds.map(buildApplication);

export function listApplications(status?: string): ApplicationListItem[] {
  return appSeeds
    .map((s, i) => ({ application: applications[i], job: jobs.find((j) => j.id === s.jobId)!, resume: s.hasResume ? resumeFor(s.jobId, s.id) : null }))
    .filter((x) => !status || x.application.status === status);
}

const STEP_ORDER = ["queued", "tailoring", "resume_review", "filling", "form_review", "submitting", "awaiting_code", "submitted"];
const STEP_MESSAGES: Record<string, string> = {
  queued: "Application queued",
  tailoring: "Retrieving evidence from the career graph and rewriting bullets for this role",
  resume_review: "Resume ready (1 page, ATS 96). Waiting for your approval",
  filling: "Opened apply form and filling fields",
  form_review: "Form filled. Review answers before sending",
  submitting: "Submitting application",
  awaiting_code: "Waiting for email verification code",
  submitted: "Application submitted",
};

export function eventsFor(status: ApplicationStatus, minutesAgo: number): RunEventRow[] {
  const idx = STEP_ORDER.includes(status) ? STEP_ORDER.indexOf(status) : status === "needs_user" ? 4 : status === "failed" ? 3 : STEP_ORDER.length - 1;
  const out: RunEventRow[] = [];
  for (let i = 0; i <= idx; i++) {
    const step = STEP_ORDER[i];
    out.push({ id: `ev-${step}`, ts: ago(Math.max(0, minutesAgo - i * 0.7)), level: "info", step, message: STEP_MESSAGES[step] });
  }
  if (status === "needs_user") out.push({ id: "ev-nu", ts: ago(minutesAgo - 5), level: "warn", step: "needs_user", message: "2 questions need your answer before the form can be sent" });
  if (status === "failed") {
    out.push({ id: "ev-f1", ts: ago(minutesAgo - 4), level: "warn", step: "filling", message: "Retrying after selector timeout (attempt 2)" });
    out.push({ id: "ev-f2", ts: ago(minutesAgo - 5), level: "error", step: "failed", message: "Could not find the submit button (#submit_app)" });
  }
  return out;
}

export function getApplication(id: string): ApplicationDetail {
  const i = applications.findIndex((a) => a.id === id);
  if (i < 0) {
    // "app-<jobId>" is what the mock createApplication returns.
    const jobId = id.replace(/^app-/, "");
    const job = jobs.find((j) => j.id === jobId) ?? jobs[0];
    const seed: AppSeed = { id, jobId: job.id, status: "queued", minutesAgo: 0, hasResume: false };
    const application = buildApplication(seed);
    return { application, job, resume: null, events: eventsFor("queued", 0), company: companies.find((c) => c.id === job.companyId) ?? null };
  }
  const seed = appSeeds[i];
  const job = jobs.find((j) => j.id === seed.jobId)!;
  return {
    application: applications[i], job,
    resume: seed.hasResume ? resumeFor(seed.jobId, seed.id) : null,
    events: eventsFor(seed.status, seed.minutesAgo),
    company: companies.find((c) => c.id === job.companyId) ?? null,
  };
}

export function createApplication(jobId: string): Application {
  return buildApplication({ id: `app-${jobId}`, jobId, status: "queued", minutesAgo: 0, hasResume: false });
}

/** Script played by the client in mock mode to emulate the SSE stream. */
export function eventScript(status: ApplicationStatus): { step: string; message: string; level?: "info" | "warn" | "error" }[] {
  const idx = Math.max(0, STEP_ORDER.indexOf(status));
  const gates = new Set(["resume_review", "form_review"]);
  const out: { step: string; message: string }[] = [];
  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    out.push({ step: STEP_ORDER[i], message: STEP_MESSAGES[STEP_ORDER[i]] });
    if (gates.has(STEP_ORDER[i])) break;
  }
  return out;
}

// ---------------------------------------------------------------- inbox
export const inbox: InboxMessage[] = [
  {
    id: "m1", applicationId: "app-3", fromAddress: "no-reply@greenhouse-mail.io", subject: "Your Helix Payments verification code",
    bodyText: "Use the code below to verify your email and continue your application.\n\nCode: 482913\n\nThis code expires in 10 minutes.",
    receivedAt: ago(8), kind: "verification_code", code: "482913", draftReply: null, read: false, source: "composio_gmail",
  },
  {
    id: "m2", applicationId: "app-7", fromAddress: "maya.ortiz@parcel.example.com", subject: "Interview with Parcel: next steps",
    bodyText: "Hi Alex,\n\nThanks for applying. We would love to set up a 45-minute call with our Head of Engineering. Does Thursday at 2pm PT or Friday at 10am PT work?\n\nBest,\nMaya",
    receivedAt: ago(60 * 5), kind: "interview", code: null,
    draftReply: "Hi Maya,\n\nThanks for reaching out, I am excited to chat. Friday at 10am PT works well for me.\n\nBest,\nAlex",
    read: false, source: "composio_gmail",
  },
  {
    id: "m3", applicationId: "app-4", fromAddress: "talent@meridiandata.example.com", subject: "Thanks for applying to Meridian Data",
    bodyText: "We received your application for Senior Frontend Engineer, Data Visualization. Our team reviews every application and will be in touch within two weeks.",
    receivedAt: ago(60 * 25), kind: "confirmation", code: null, draftReply: null, read: true, source: "composio_gmail",
  },
  {
    id: "m4", applicationId: null, fromAddress: "recruiting@northpoint.example.com", subject: "Frontend role at Northpoint: quick intro?",
    bodyText: "Hi Alex, I came across your profile and think you would be a strong fit for a Senior Frontend role on our growth team. Open to a 15 minute intro this week?",
    receivedAt: ago(60 * 30), kind: "recruiter_reply", code: null,
    draftReply: "Hi, thanks for reaching out. I am currently focused on a few late-stage processes but happy to hear more. Could you share the compensation range and team size?",
    read: false, source: "composio_gmail",
  },
  {
    id: "m5", applicationId: "app-6", fromAddress: "jobs@kestrelrobotics.example.com", subject: "Update on your application",
    bodyText: "Thank you for your interest in Kestrel Robotics. After careful consideration we have decided to move forward with other candidates at this time.",
    receivedAt: ago(60 * 48), kind: "rejection", code: null, draftReply: "Thank you for letting me know. I appreciate the consideration and would be glad to stay in touch for future roles.", read: true, source: "composio_gmail",
  },
  {
    id: "m6", applicationId: null, fromAddress: "offers@tidewater.example.com", subject: "Offer discussion: Tidewater",
    bodyText: "Congratulations Alex! We would like to extend an offer for the Frontend Engineer, Design Systems role. Please let us know a time to walk through the details.",
    receivedAt: ago(60 * 70), kind: "offer", code: null, draftReply: "Thank you so much, I am delighted. I am available Monday afternoon for a call to review the details.", read: true, source: "composio_gmail",
  },
];

export const trackerStats: TrackerStats = {
  byStatus: { queued: 1, tailoring: 1, resume_review: 1, form_review: 1, needs_user: 1, submitted: 6, viewed: 3, replied: 2, interview: 2, offer: 1, rejected: 4, failed: 1 },
  thisWeek: { applied: 14, replied: 4, interview: 2, hoursSaved: 11.5 },
};

export const channels: Channel[] = [
  { id: "ch1", kind: "telegram", address: "@alexchen (chat 502931145)", createdAt: ago(60 * 24 * 10) },
];

export const integrations: Integration[] = [
  { toolkit: "gmail", connected: true },
  { toolkit: "googlesheets", connected: false },
  { toolkit: "googlecalendar", connected: false },
  { toolkit: "slack", connected: false },
];

// ---------------------------------------------------------------- auth / onboarding
/** Mock mode treats the user as already onboarded so every page renders; /onboarding?step=<id> opens any step. */
export const onboarding: OnboardingState = { step: "done", profile: me.profile };

export const ingest: IngestResult = {
  nodesCreated: nodes.length,
  edgesCreated: edges.length,
  usedLLM: false,
  profilePatch: {
    fullName: me.profile.fullName!, email: me.profile.email!, phone: me.profile.phone!, linkedin: me.profile.linkedin!,
    github: me.profile.github!, website: me.profile.website!, location: me.profile.location!,
  },
  nodes,
};

// ---------------------------------------------------------------- agent
const jobRef = (id: string) => {
  const j = jobs.find((x) => x.id === id)!;
  return { title: j.title, companyName: j.companyName };
};

export const agentActivity: AgentActivity[] = [
  { id: "ag1", ts: ago(20), kind: "review_requested", applicationId: "app-2", jobId: "j3", message: "Tailored resume ready for Tidewater, ATS 96", data: { job: jobRef("j3") } },
  { id: "ag2", ts: ago(21), kind: "queued", applicationId: "app-8", jobId: "j9", message: "Queued Northpoint, match 89%", data: { job: jobRef("j9") } },
  { id: "ag3", ts: ago(22), kind: "skipped", jobId: "j8", message: "Skipped Fieldnote, Engineering Manager", data: { job: jobRef("j8"), reasons: ["match 52% below 75%", "management track"] } },
  { id: "ag4", ts: ago(23), kind: "skipped", jobId: "j7", message: "Skipped Parcel, Senior Product Engineer", data: { job: jobRef("j7"), reasons: ["match 69% below 75%", "remote (global)"] } },
  { id: "ag5", ts: ago(24), kind: "scored", message: "Scored 14 new roles against your graph", data: { count: 14 } },
  { id: "ag6", ts: ago(26), kind: "discovered", message: "Found 14 new roles across 5 boards", data: { count: 14 } },
  { id: "ag7", ts: ago(60 * 3), kind: "needs_user", applicationId: "app-5", jobId: "j4", message: "Orbital Health asks for a salary expectation", data: { job: jobRef("j4") } },
  { id: "ag8", ts: ago(60 * 5), kind: "submitted", applicationId: "app-4", jobId: "j5", message: "Submitted to Meridian Data", data: { job: jobRef("j5") } },
  { id: "ag9", ts: ago(60 * 6), kind: "approved", applicationId: "app-4", jobId: "j5", message: "Resume approved for Meridian Data", data: { job: jobRef("j5") } },
  { id: "ag10", ts: ago(60 * 9), kind: "reply", applicationId: "app-7", jobId: "j7", message: "Parcel replied, drafted an answer", data: { job: jobRef("j7") } },
  { id: "ag11", ts: ago(60 * 24 * 2), kind: "interview", applicationId: "app-7", jobId: "j7", message: "Interview invite from Parcel, Thursday 2pm", data: { job: jobRef("j7") } },
  { id: "ag12", ts: ago(60 * 24 * 2 + 30), kind: "brief", message: "Morning brief: 3 submitted, 2 replies, 1 interview", data: { count: 3 } },
];

export function agentStatus(): AgentStatus {
  return {
    lastTickAt: ago(20),
    nextTickAt: new Date(Date.now() + 12 * MIN).toISOString(),
    dailyCap: 10,
    usedToday: 3,
    minScore: 0.75,
    autoApprove: me.profile.resumeAutoApprove,
    reviewBeforeSubmit: me.profile.reviewBeforeSubmit,
    channels: channels.map((c) => ({ kind: c.kind, address: c.address })),
    mode: modelSettings().mode,
    lanes: laneState.map((l, i) => ({ id: l.id, name: l.name, enabled: l.enabled, queuedToday: l.enabled ? [2, 1, 0][i] ?? 0 : 0 })),
    awaitingReview: [
      { applicationId: "app-2", title: "Frontend Engineer, Design Systems", companyName: "Tidewater", atsScore: 96, changes: 6 },
      { applicationId: "app-3", title: "Staff Software Engineer, Web Platform", companyName: "Helix Payments", atsScore: 93, changes: 4 },
    ],
  };
}

// ---------------------------------------------------------------- lanes and model (hackathon)
let laneState: Lane[] = [
  { id: "lane-1", name: "Frontend, remote", titles: ["Senior Frontend Engineer", "Staff Frontend Engineer"], locations: ["Remote (US)"], remote: "only", minScore: 0.8, enabled: true },
  { id: "lane-2", name: "Staff platform", titles: ["Staff Software Engineer", "Platform Engineer"], locations: ["San Francisco", "New York"], remote: "ok", minScore: 0.78, enabled: true },
  { id: "lane-3", name: "Design systems", titles: ["Design Systems Engineer"], locations: [], remote: "ok", minScore: 0.85, enabled: false },
];
export const lanes = (): Lane[] => laneState.map((l) => ({ ...l }));
export function saveLanes(next: Lane[]): Lane[] {
  laneState = next.map((l) => ({ ...l }));
  return lanes();
}

let modelState: ModelSettings = {
  provider: "cline", baseUrl: "https://api.cline.bot/api/v1", qualityModel: "deepseek/deepseek-v4-pro", bulkModel: "qwen/qwen3.7-plus", hasKey: true, mode: "cline",
};
export const modelSettings = (): ModelSettings => ({ ...modelState });
export function saveModelSettings(input: ModelSettingsInput): ModelSettings {
  const hasKey = input.provider === "ollama" ? modelState.hasKey : modelState.provider === input.provider ? modelState.hasKey || !!input.apiKey : !!input.apiKey;
  const mode: ModelMode = input.provider === "ollama" ? "ollama" : hasKey ? input.provider : "heuristic";
  modelState = {
    provider: input.provider,
    baseUrl: input.baseUrl ?? modelState.baseUrl,
    qualityModel: input.qualityModel ?? modelState.qualityModel,
    bulkModel: input.bulkModel ?? modelState.bulkModel,
    hasKey,
    mode,
  };
  return modelSettings();
}
export function testModel(): ModelTestResult {
  if (modelState.mode === "heuristic") return { ok: false, model: "", latencyMs: 0, sample: "", error: "No key saved." };
  return { ok: true, model: modelState.qualityModel ?? "deepseek/deepseek-v4-pro", latencyMs: 842, sample: "ok" };
}

export function agentTick(): AgentTickSummary {
  return { discovered: 6, scored: 6, queued: 2, skipped: [{}, {}, {}], awaitingReview: 2, submitted: 1, needsUser: 1 };
}

export function agentReply(text: string): { reply: string } {
  const t = text.toLowerCase();
  if (t.includes("today")) return { reply: "Found 14 roles, queued 2, skipped 3. Tidewater and Helix are waiting on your approval." };
  if (t.includes("find") || t.includes("staff")) return { reply: "Searching staff frontend roles, remote. I will queue anything above 75% on the next run." };
  if (t.includes("missing") || t.includes("match")) return { reply: "Corvid AI, 91%. Missing: GraphQL federation at scale. Your Helix work covers most of it; add one line." };
  return { reply: "Noted. I will fold that into the next run." };
}
