import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb, type Db } from "../db/client.js";
import { users, profiles, type JobRequirements } from "../db/schema.js";
import { setLLM, LLMUnavailableError } from "../llm/index.js";
import {
  ingestResume, getGraph, retrieveEvidence, skillGaps, buildBaselineResume, addFact,
  canonicalSkill, findSkills, normalizeSkill, ALL_SKILLS,
} from "./index.js";

const RESUME = `Jordan Rivera
San Francisco, CA | jordan.rivera@example.com | (415) 555-0199 | linkedin.com/in/jordanrivera | jordanrivera.dev

SUMMARY
Full-stack engineer focused on product-led startups.

EXPERIENCE

Senior Software Engineer at Northwind Labs
Jan 2022 – Present
• Led migration of the checkout flow to React and TypeScript, cutting page load time by 45%
• Built a Node.js and PostgreSQL billing service processing $12M in annual payments
- Mentored 4 engineers and ran weekly code reviews across the platform team
* Reduced AWS spend by 30% by moving batch jobs to Docker containers on ECS

Software Engineer | Brightside Analytics | Mar 2019 - Dec 2021
• Developed a Python and Airflow ETL pipeline ingesting 2M events per day
• Improved dashboard query latency 3x by redesigning PostgreSQL indexes
– Shipped a customer-facing React dashboard used by 1,200 customers

Acme Corp — Junior Developer (Jun 2017 – Feb 2019)
- Automated the release process with Jenkins and Bash, saving 10 hours per week
- Wrote Java services for order processing and added unit tests that raised coverage to 85%

EDUCATION
B.S. in Computer Science, University of Washington
2013 - 2017

SKILLS
Languages: Python, TypeScript, JavaScript, Java, SQL, Go
Frameworks: React, Node.js, Django, GraphQL
Cloud & Tools: AWS, Docker, Terraform, Git, CI/CD

CERTIFICATIONS
AWS Certified Solutions Architect – Associate (2022)
`;

const REQS: JobRequirements = {
  skills: [{ name: "React", required: true }, { name: "Kubernetes", required: false }],
  seniority: "senior",
  roleFamily: "software engineering",
  yearsMin: 4,
  mustHaves: ["4+ years React"],
  niceToHaves: [],
  disqualifiers: [],
  keywords: ["TypeScript"],
  summary: "Senior frontend engineer",
};

let db: Db;
let userId: string;

beforeAll(async () => {
  setLLM({
    provider: "none", model: "none", available: false,
    async json() { throw new LLMUnavailableError(); },
    async text() { throw new LLMUnavailableError(); },
  });
  db = await openTestDb();
  const [u] = await db.insert(users).values({ email: "jordan@example.com" }).returning();
  userId = u.id;
  await db.insert(profiles).values({ userId, email: "jordan@example.com" });
});

describe("skills dictionary", () => {
  it("has at least 150 canonical skills", () => {
    expect(ALL_SKILLS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(ALL_SKILLS).size).toBe(ALL_SKILLS.length);
  });

  it("canonicalizes synonyms", () => {
    expect(canonicalSkill("reactjs")).toBe("React");
    expect(canonicalSkill("Postgres")).toBe("PostgreSQL");
    expect(canonicalSkill("k8s")).toBe("Kubernetes");
    expect(canonicalSkill("golang")).toBe("Go");
    expect(canonicalSkill("4+ years React")).toBe("React");
    expect(canonicalSkill("quarterly planning rituals")).toBeNull();
    expect(normalizeSkill("  node js ")).toBe("Node.js");
    expect(normalizeSkill("Underwater Basket Weaving")).toBe("Underwater Basket Weaving");
  });

  it("finds skills with word boundaries, in order of appearance", () => {
    expect(findSkills("Built C++ and C# services on .NET, plus Node.js tooling")).toEqual(["C++", "C#", ".NET", "Node.js"]);
    expect(findSkills("JavaScript and Java")).toEqual(["JavaScript", "Java"]);
    expect(findSkills("Wrote ASP.NET apps")).toEqual([".NET"]);
    expect(findSkills("React Native app")).toEqual(["React Native"]);
    expect(findSkills("Languages: Python, Go, R")).toEqual(["Python", "Go", "R"]);
    expect(findSkills("Go to market plan; the rest of the team")).toEqual(["Go-to-Market"]);
    expect(findSkills("No skills here at all")).toEqual([]);
  });

  it("treats business functions as disciplines, not adjectives", () => {
    expect(findSkills("Built marketing sites and landing pages")).toEqual([]);
    expect(findSkills("Shipped marketing websites, sales pages and marketing emails")).toEqual([]);
    expect(findSkills("Marketing Manager")).toEqual(["Marketing"]);
    expect(findSkills("Led digital marketing and content marketing")).toContain("Marketing");
    expect(findSkills("Ran marketing campaigns")).toContain("Marketing");
    expect(findSkills("Worked in marketing")).toContain("Marketing");
  });
});

describe("career graph (heuristic path)", () => {
  it("ingests a resume into nodes and edges, patches the profile, and is idempotent", async () => {
    const first = await ingestResume(db, userId, RESUME);
    expect(first.usedLLM).toBe(false);
    expect(first.edgesCreated).toBeGreaterThan(0);
    expect(first.profilePatch.fullName).toBe("Jordan Rivera");
    expect(first.profilePatch.phone).toBeTruthy();
    expect(first.profilePatch.linkedin).toContain("linkedin.com/in/jordanrivera");
    expect(first.profilePatch.location).toBe("San Francisco, CA");
    expect(first.profilePatch.email).toBeUndefined(); // already set on the profile

    const g = await getGraph(db, userId);
    const count = (t: string) => g.nodes.filter((n) => n.type === t).length;
    expect(count("role")).toBeGreaterThanOrEqual(3);
    expect(count("skill")).toBeGreaterThanOrEqual(8);
    expect(count("metric")).toBeGreaterThanOrEqual(6);
    expect(count("education")).toBe(1);
    expect(count("certification")).toBe(1);
    expect(count("company")).toBeGreaterThanOrEqual(3);
    for (const type of ["worked_at", "used", "achieved", "studied_at", "earned"]) {
      expect(g.edges.some((e) => e.type === type), type).toBe(true);
    }

    const roles = g.nodes.filter((n) => n.type === "role");
    const northwind = roles.find((r) => r.label === "Senior Software Engineer at Northwind Labs");
    expect(northwind?.startDate).toBe("2022-01");
    expect(northwind?.endDate).toBeNull();
    expect(roles.find((r) => r.label.startsWith("Software Engineer at Brightside"))?.startDate).toBe("2019-03");
    expect(roles.find((r) => r.label === "Junior Developer at Acme Corp")?.endDate).toBe("2019-02");

    const metric = g.nodes.find((n) => n.type === "metric" && String(n.props.statement).includes("45%"));
    expect(metric?.props.value).toBe("45");
    expect(metric?.props.unit).toBe("%");

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(profile.rawResumeText).toBe(RESUME);
    expect(profile.fullName).toBe("Jordan Rivera");
    expect(profile.location).toBe("San Francisco, CA");

    const second = await ingestResume(db, userId, RESUME);
    expect(second.nodesCreated).toBe(0);
    expect(second.edgesCreated).toBe(0);
    expect(second.profilePatch).toEqual({});
    expect((await getGraph(db, userId)).nodes.length).toBe(g.nodes.length);
  });

  it("retrieves evidence for requirements and reports gaps", async () => {
    const evidence = await retrieveEvidence(db, userId, REQS);
    const react = evidence.filter((e) => e.requirement === "React");
    expect(react.length).toBeGreaterThan(0);
    expect(react[0].roleLabel).toBeTruthy();
    expect(react[0].companyLabel).toBeTruthy();
    expect(react.some((e) => e.nodeType === "metric" && e.text.includes("45%"))).toBe(true);
    expect(react.every((e) => e.score > 0)).toBe(true);
    // required React evidence outranks the nice-to-have Kubernetes (which has none)
    expect(evidence.some((e) => e.requirement === "TypeScript")).toBe(true);
    expect(evidence.some((e) => e.requirement === "Kubernetes")).toBe(false);
    // sorted best first
    expect(evidence.map((e) => e.score)).toEqual([...evidence.map((e) => e.score)].sort((a, b) => b - a));

    const gaps = await skillGaps(db, userId, REQS);
    expect(gaps.map((g) => g.requirement)).toContain("Kubernetes");
    expect(gaps.find((g) => g.requirement === "Kubernetes")?.required).toBe(false);
    expect(gaps.map((g) => g.requirement)).not.toContain("React");
  });

  it("counts skills listed only in the skills section, and soft skills, as evidence", async () => {
    const reqs: JobRequirements = { ...REQS, skills: [{ name: "Django", required: true }, { name: "Terraform", required: false }, { name: "Communication", required: true }, { name: "Kubernetes", required: false }], mustHaves: [], keywords: [] };
    const evidence = await retrieveEvidence(db, userId, reqs);
    const django = evidence.find((e) => e.requirement === "Django");
    expect(django?.text).toBe("Listed skill: Django");
    expect(django?.nodeType).toBe("skill");
    expect(django?.score).toBe(0.6);
    expect(evidence.find((e) => e.requirement === "Terraform")?.score).toBe(0.3);
    const comm = evidence.find((e) => e.requirement === "Communication");
    expect(comm).toBeTruthy();
    expect(comm!.score).toBeLessThan(0.6);
    const react = (await retrieveEvidence(db, userId, REQS)).filter((e) => e.requirement === "React");
    expect(Math.max(...react.map((e) => e.score))).toBeGreaterThan(0.6);
    expect((await skillGaps(db, userId, reqs)).map((g) => g.requirement)).toEqual(["Kubernetes"]);

    // soft skills need a work history
    const other = await openTestDb();
    const [u] = await other.insert(users).values({ email: "soft@example.com" }).returning();
    expect((await skillGaps(other, u.id, reqs)).map((g) => g.requirement)).toContain("Communication");
  });

  it("builds a baseline resume from the graph, newest role first", async () => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const resume = await buildBaselineResume(db, userId, profile);
    expect(resume.name).toBe("Jordan Rivera");
    expect(resume.contact.email).toBe("jordan@example.com");
    expect(resume.experience.map((e) => e.company)).toEqual(["Northwind Labs", "Brightside Analytics", "Acme Corp"]);
    expect(resume.experience[0].start).toBe("Jan 2022");
    expect(resume.experience[0].end).toBe("Present");
    for (const e of resume.experience) {
      expect(e.bullets.length).toBeGreaterThan(0);
      for (const b of e.bullets) expect(b.nodeIds).toHaveLength(1);
    }
    expect(resume.experience[0].bullets[0].text).toContain("checkout");
    expect(resume.education[0].school).toBe("University of Washington");
    expect(resume.education[0].field).toBe("Computer Science");
    const groups = Object.fromEntries(resume.skills.map((s) => [s.group, s.items]));
    expect(groups.Languages).toContain("Python");
    expect(groups.Frameworks).toContain("React");
    expect(groups.Cloud).toContain("Docker");
    expect(resume.certifications?.[0]).toContain("AWS Certified");
  });

  it("adds a conversational fact as a metric on the most recent role", async () => {
    const before = await getGraph(db, userId);
    const res = await addFact(db, userId, "I led a migration that cut costs 30% at Northwind last year");
    expect(res.nodesCreated).toBe(1);
    expect(res.summary).toContain("Northwind");
    const after = await getGraph(db, userId);
    const added = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id));
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("metric");
    expect(added[0].props.value).toBe("30");
    const owner = after.edges.find((e) => e.dst === added[0].id);
    expect(after.nodes.find((n) => n.id === owner?.src)?.label).toContain("Northwind");

    const again = await addFact(db, userId, "I led a migration that cut costs 30% at Northwind last year");
    expect(again.nodesCreated).toBe(0);
  });

  it("falls back to a standalone project when the graph has no roles", async () => {
    const other = await openTestDb();
    const [u] = await other.insert(users).values({ email: "fresh@example.com" }).returning();
    const res = await addFact(other, u.id, "Built a command line tool adopted by 500 teams");
    expect(res.nodesCreated).toBe(2);
    const g = await getGraph(other, u.id);
    expect(g.nodes.map((n) => n.type).sort()).toEqual(["metric", "project"]);
  });
});
