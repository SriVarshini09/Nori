/**
 * `npm run live:model -- gpt-4.1-mini gpt-5-mini`: runs a real call against the model provider in your .env
 * (HOSTED_LLM_* or ANTHROPIC_API_KEY), once per model name given: a one-word connectivity check, then a real tailoring of
 * the sample resume. Prints timings and how many lines the truthfulness check kept or rejected. Costs a few cents per model.
 * The key is read from the environment and is scrubbed from anything printed.
 */
import "../apps/worker/src/env.js";
import { getLLM, setLLM, tailorResume, testUserModel } from "@jobgraph/core";
import { sampleBaseline, sampleEvidence, sampleRequirements } from "../packages/core/src/tailor/sample.fixture.js";

const key = process.env.HOSTED_LLM_API_KEY!;
const scrub = (s: string) => s.split(key).join("[key]");
const input = { baseline: sampleBaseline, requirements: sampleRequirements, evidence: sampleEvidence, jobTitle: "Senior Full-Stack Engineer", companyName: "Omega Pay" };

for (const model of process.argv.slice(2)) {
  process.env.HOSTED_LLM_QUALITY_MODEL = model;
  process.env.HOSTED_LLM_BULK_MODEL = model;
  setLLM(null);
  const llm = getLLM("quality");
  const t0 = Date.now();
  // 1. a tiny completion
  let ping = "";
  try { ping = (await llm.text({ system: "You are a connectivity check.", prompt: "Reply with the single word ready", maxTokens: 64, timeoutMs: 60_000 })).trim().slice(0, 30); }
  catch (e) { ping = "ERROR: " + scrub((e as Error).message).slice(0, 220); }
  const pingMs = Date.now() - t0;
  // 2. a real tailoring
  const t1 = Date.now();
  let line: string;
  try {
    const r = await tailorResume(input);
    line = `used model: ${r.usedLLM} | ${((Date.now() - t1) / 1000).toFixed(1)}s | changed ${r.changes.length}/9 | rejected as untrue ${r.rejected.length}${r.rejected.length ? " (" + r.rejected.map((x) => x.reason).join("; ").slice(0, 160) + ")" : ""}`;
    console.log(`\n=== ${model}\nping: "${ping}" (${pingMs} ms)\n${line}`);
    for (const c of r.changes.slice(0, 3)) console.log(`  - ${c.after}`);
  } catch (e) {
    console.log(`\n=== ${model}\nping: "${ping}" (${pingMs} ms)\ntailor ERROR: ${scrub((e as Error).message).slice(0, 220)}`);
  }
}
process.exit(0);
