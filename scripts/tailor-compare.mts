/**
 * `npm run tailor:compare [-- --model]`: tailors one candidate to several different jobs and scores each result with the
 * recruiter review (packages/core/src/tailor/recruiter.ts), next to the untouched resume. Without --model it runs the
 * rule-based path only (no key, no cost). With --model it also runs the model path using the provider in .env.
 * Prints the scores, the summary line and the concerns, so a change to the tailoring can be judged by numbers.
 */
import "../apps/worker/src/env.js";
import { recruiterReview, setLLM, tailorResume, tailorResumeHeuristic, type JobRequirements } from "@jobgraph/core";
import { sampleBaseline, sampleEvidence, sampleRequirements } from "../packages/core/src/tailor/sample.fixture.js";

const useModel = process.argv.includes("--model");
const req = (over: Partial<JobRequirements>): JobRequirements => ({ ...sampleRequirements, ...over });

const JOBS: { title: string; company: string; requirements: JobRequirements }[] = [
  { title: "Senior Full-Stack Engineer", company: "Omega Pay", requirements: sampleRequirements },
  { title: "Senior Frontend Engineer, Design Systems", company: "Lumen", requirements: req({
    skills: [{ name: "React", required: true }, { name: "TypeScript", required: true }, { name: "Accessibility", required: true }, { name: "Design Systems", required: true }, { name: "Storybook", required: false }, { name: "Jest", required: false }],
    roleFamily: "frontend", yearsMin: 6, keywords: ["React", "TypeScript", "accessibility", "design systems", "component library", "performance"], niceToHaves: ["Storybook"], mustHaves: ["Own a component library used by several teams"] }) },
  { title: "Platform Engineer", company: "Kiln", requirements: req({
    skills: [{ name: "Go", required: true }, { name: "Kubernetes", required: true }, { name: "PostgreSQL", required: true }, { name: "Docker", required: false }, { name: "AWS", required: false }],
    roleFamily: "backend", yearsMin: 7, keywords: ["Go", "Kubernetes", "PostgreSQL", "infrastructure", "reliability"], niceToHaves: ["Terraform"], mustHaves: ["Run production services on Kubernetes"] }) },
  { title: "Staff Software Engineer", company: "Vantage", requirements: req({ seniority: "staff", yearsMin: 10, roleFamily: "fullstack",
    skills: [{ name: "React", required: true }, { name: "Node.js", required: true }, { name: "System Design", required: true }, { name: "Mentoring", required: false }], keywords: ["React", "Node.js", "architecture", "mentoring", "technical leadership"], mustHaves: ["Technical leadership across teams"] }) },
  { title: "Software Engineer I", company: "Pebble", requirements: req({ seniority: "junior", yearsMin: 1, roleFamily: "fullstack", skills: [{ name: "JavaScript", required: true }, { name: "React", required: false }, { name: "SQL", required: false }], keywords: ["JavaScript", "React", "SQL", "testing"], mustHaves: [] }) },
];

const line = (s: string, n = 118) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
let total = { base: 0, heur: 0, model: 0 };
for (const job of JOBS) {
  const input = { baseline: sampleBaseline, requirements: job.requirements, evidence: sampleEvidence, jobTitle: job.title, companyName: job.company };
  const base = recruiterReview(sampleBaseline, job.requirements, { jobTitle: job.title });
  const heur = tailorResumeHeuristic(input);
  const hr = recruiterReview(heur.content, job.requirements, { jobTitle: job.title });
  console.log(`\n=== ${job.title} @ ${job.company}   untouched ${base.score} | rules ${hr.score}`);
  console.log(`  summary (rules): ${heur.content.summary}`);
  total.base += base.score; total.heur += hr.score;
  let best = hr;
  if (useModel) {
    setLLM(null);
    const m = await tailorResume(input);
    const mr = recruiterReview(m.content, job.requirements, { jobTitle: job.title });
    total.model += mr.score; best = mr;
    console.log(`  model path: used model ${m.usedLLM} | score ${mr.score} | changed ${m.changes.length} | rejected ${m.rejected.length}`);
    console.log(`  summary (model): ${m.content.summary}`);
    for (const x of m.rejected.slice(0, 6)) console.log(`  rejected ${x.bulletId}: ${x.reason}`);
  }
  for (const c of best.concerns.slice(0, 4)) console.log(`  [${c.severity}] ${line(c.title)}`);
  console.log(`  must-haves: ${best.musts.filter((x) => x.required).map((x) => `${x.skill}=${x.status}`).join(", ")}`);
}
const n = JOBS.length;
console.log(`\naverage: untouched ${(total.base / n).toFixed(1)} | rules ${(total.heur / n).toFixed(1)}${useModel ? ` | model ${(total.model / n).toFixed(1)}` : ""}`);
process.exit(0);
