import type { Evidence } from "../contracts.js";
import type { JobRequirements, ResumeContent } from "../db/schema.js";

/** Test fixtures for tailor/ (not exported from the package). */

export const sampleRequirements: JobRequirements = {
  skills: [
    { name: "React", required: true }, { name: "TypeScript", required: true }, { name: "Node.js", required: true },
    { name: "PostgreSQL", required: true }, { name: "GraphQL", required: false }, { name: "AWS", required: false },
  ],
  seniority: "senior", roleFamily: "fullstack", yearsMin: 5,
  mustHaves: ["Shipped customer-facing web products end to end"],
  niceToHaves: ["Design systems"],
  disqualifiers: [],
  keywords: ["React", "TypeScript", "Node.js", "PostgreSQL", "performance", "accessibility"],
  summary: "Senior full-stack engineer for a payments dashboard.",
};

const b = (id: string, text: string, nodeIds: string[]) => ({ id, text, nodeIds });

export const sampleBaseline: ResumeContent = {
  name: "Jordan Rivera",
  contact: { email: "jordan.rivera@example.com", phone: "(555) 010-2030", location: "San Francisco, CA", linkedin: "linkedin.com/in/jordanrivera" },
  summary: "Engineer who builds web products.",
  experience: [
    {
      title: "Senior Software Engineer", company: "Acme Payments", location: "San Francisco, CA", start: "2021-04", end: undefined,
      bullets: [
        b("b1", "Responsible for building the merchant dashboard used by 12,000 businesses to reconcile daily payouts", ["r1", "m1", "s-react"]),
        b("b2", "Cut p95 API latency from 900ms to 250ms by adding query indexes and a read-through cache", ["r1", "m2", "s-pg"]),
        b("b3", "Led accessibility audit and remediation that brought the checkout flow to WCAG 2.1 AA compliance", ["r1", "m3"]),
        b("b4", "Mentored 3 engineers through weekly pairing sessions and structured code review feedback", ["r1", "m4"]),
      ],
    },
    {
      title: "Software Engineer", company: "Beta Health", location: "Remote", start: "2018-06", end: "2021-03",
      bullets: [
        b("b5", "Built a patient scheduling service handling 40,000 bookings per month across 90 clinics", ["r2", "m5", "s-node"]),
        b("b6", "Migrated a legacy jQuery front end to a component library, reducing bundle size by 35%", ["r2", "m6"]),
        b("b7", "Wrote integration tests that raised coverage from 45% to 80% and halved regression bugs", ["r2", "m7"]),
      ],
    },
    {
      title: "Junior Developer", company: "Gamma Studio", location: "Austin, TX", start: "2016-07", end: "2018-05",
      bullets: [
        b("b8", "Developed marketing sites for 15 clients with a shared template and automated deploys", ["r3", "m8"]),
        b("b9", "Automated image optimization in the build pipeline, cutting average page weight by 50%", ["r3", "m9"]),
      ],
    },
  ],
  education: [{ school: "University of Texas at Austin", degree: "B.S.", field: "Computer Science", start: "2012", end: "2016" }],
  skills: [
    { group: "Languages", items: ["JavaScript", "Python", "TypeScript", "SQL"] },
    { group: "Frameworks", items: ["Express", "React", "Jest"] },
    { group: "Data & Cloud", items: ["Redis", "PostgreSQL", "Docker"] },
  ],
  certifications: ["AWS Certified Developer - Associate"],
};

export const sampleEvidence: Evidence[] = [
  { requirement: "React", nodeId: "s-react", nodeType: "skill", label: "React", text: "React", roleId: "r1", roleLabel: "Senior Software Engineer", companyLabel: "Acme Payments", score: 0.9 },
  { requirement: "TypeScript", nodeId: "m1", nodeType: "metric", label: "Merchant dashboard", text: "Built the merchant dashboard in React and TypeScript, used by 12,000 businesses", roleId: "r1", roleLabel: "Senior Software Engineer", companyLabel: "Acme Payments", score: 0.85 },
  { requirement: "PostgreSQL", nodeId: "s-pg", nodeType: "skill", label: "PostgreSQL", text: "PostgreSQL", roleId: "r1", score: 0.8 },
  { requirement: "performance", nodeId: "m2", nodeType: "metric", label: "API latency", text: "p95 latency 900ms to 250ms via PostgreSQL indexes and Redis cache", roleId: "r1", score: 0.8 },
  { requirement: "Node.js", nodeId: "s-node", nodeType: "skill", label: "Node.js", text: "Node.js", roleId: "r2", roleLabel: "Software Engineer", companyLabel: "Beta Health", score: 0.8 },
  { requirement: "Node.js", nodeId: "m5", nodeType: "metric", label: "Scheduling service", text: "Scheduling service in Node.js and Express, 40,000 bookings per month", roleId: "r2", score: 0.75 },
  { requirement: "accessibility", nodeId: "m3", nodeType: "metric", label: "Accessibility audit", text: "WCAG 2.1 AA compliance for checkout", roleId: "r1", score: 0.7 },
];

/** Six long roles: overflows one page until the fitting loop trims it. */
export function longBaseline(): ResumeContent {
  const companies = ["Acme Payments", "Beta Health", "Gamma Studio", "Delta Logistics", "Epsilon Media", "Zeta Labs"];
  const titles = ["Staff Software Engineer", "Senior Software Engineer", "Software Engineer II", "Software Engineer", "Web Developer", "Junior Developer"];
  const verbs = ["Built", "Led", "Reduced", "Designed", "Shipped", "Automated", "Migrated"];
  return {
    ...sampleBaseline,
    summary: "Full-stack engineer with a decade of experience shipping payments, health and logistics products with React, TypeScript, Node.js and PostgreSQL across startups and growth-stage companies.",
    experience: companies.map((company, i) => ({
      title: titles[i], company, location: "San Francisco, CA",
      start: `${2024 - i * 2 - 2}-01`, end: i === 0 ? undefined : `${2024 - i * 2}-01`,
      bullets: Array.from({ length: 7 }, (_, k) => b(
        `L${i}-${k}`,
        `${verbs[k % verbs.length]} a ${["billing", "search", "reporting", "onboarding", "alerting", "routing", "export"][k]} workflow in React and Node.js that served ${(k + 2) * 1000} customers and cut support tickets by ${10 + k * 5}% within two quarters`,
        [`role${i}`, `m${i}-${k}`],
      )),
    })),
    projects: [{ name: "Open-source form library", bullets: [b("p1", "Maintained a TypeScript form validation library with 2,000 GitHub stars and 40 contributors worldwide", ["proj1"])] }],
  };
}
