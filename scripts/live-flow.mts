/**
 * `npm run live:flow`: the whole pipeline against the model provider in your .env, with everything else offline
 * (in-memory database, fake form driver, no real submission). It reads a sample resume into a career graph, scores four
 * jobs, tailors three applications and writes the free-text answers. Then it prints what the model actually produced so
 * you can judge it. Costs a few cents. The key is read from the environment and never printed.
 */
import "../apps/worker/src/env.js";
import { seedUser, startStack } from "./stack.mjs";

const key = process.env.HOSTED_LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
const scrub = (s: string) => (key ? s.split(key).join("[key]") : s);

const stack = await startStack({ realModel: true });
let code = 0;
try {
  const t0 = Date.now();
  const seed = await seedUser(stack);
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(0)}s (reading the resume, scoring 4 jobs, tailoring 3 applications)\n`);
  const get = async (p: string) => (await fetch(stack.apiUrl + p, { headers: { cookie: seed.cookie } })).json() as Promise<any>;

  const me = await get("/api/health");
  console.log("model in use:", JSON.stringify(me.models), "\n");

  const g = await get("/api/graph");
  const byType: Record<string, number> = {};
  for (const n of g.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  console.log("career graph:", JSON.stringify(byType), `| ${g.edges.length} edges`);

  const jobs = await get("/api/jobs?limit=10");
  console.log("\nmatches:");
  for (const j of jobs.sort((a: any, b: any) => (b.match?.score ?? 0) - (a.match?.score ?? 0))) {
    console.log(`  ${Math.round((j.match?.score ?? 0) * 100)}%  ${j.job.title} @ ${j.job.companyName}  | ${(j.match?.explanation.reasons ?? []).slice(0, 2).join("; ")}`);
  }

  const a = await get(`/api/applications/${seed.apps.resumeReview}`);
  console.log(`\ntailored resume for "${a.job.title}": ATS ${a.resume.atsScore}, ${a.resume.changes.length} changes`);
  for (const c of a.resume.changes.slice(0, 4)) console.log(`  - ${c.after}\n      (${c.reason})`);
  console.log(`  summary: ${a.resume.content.summary}`);

  const n = await get(`/api/applications/${seed.apps.needsAnswers}`);
  console.log(`\napplication that needs answers: ${n.application.status}`);
  for (const [q, v] of Object.entries(n.application.answers as Record<string, string>)) console.log(`  Q: ${q}\n  A: ${String(v).slice(0, 300)}`);
  for (const q of n.application.pendingQuestions) console.log(`  still asks you: ${q.label}${q.required ? " (required)" : ""}`);
} catch (e) {
  console.log("FAILED:", scrub((e as Error).message));
  code = 1;
} finally {
  await stack.stop();
}
process.exit(code);
