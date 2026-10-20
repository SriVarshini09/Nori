/**
 * Tailoring quality check against real models: `npx tsx scripts/tailor-eval.mts qwen3:4b qwen3.5:9b`
 * (local Ollama on the default port). For each model it tailors the sample resume to the sample job and reports whether
 * the model was used at all, how many prompt sizes it needed, how long it took, how many rewritten lines the truthfulness
 * check accepted, and which it rejected and why. Nothing leaves the machine. Writes test-results/tailor-eval.md.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { llmFromSpec, ollamaSpec, setLLM, tailorResume, type LLM } from "@jobgraph/core";
import { sampleBaseline, sampleEvidence, sampleRequirements } from "../packages/core/src/tailor/sample.fixture.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const models = process.argv.slice(2);
if (!models.length) { console.error("usage: tailor-eval.mts <ollama model> [...]"); process.exit(2); }

const input = { baseline: sampleBaseline, requirements: sampleRequirements, evidence: sampleEvidence, jobTitle: "Senior Full-Stack Engineer", companyName: "Omega Pay" };
const bulletCount = sampleBaseline.experience.reduce((n, r) => n + r.bullets.length, 0);
const rows: string[] = [];

for (const model of models) {
  const inner = llmFromSpec(ollamaSpec("quality", model));
  const sizes: number[] = [];
  const errors: string[] = [];
  const spy: LLM = {
    ...inner,
    async json(call) {
      sizes.push(call.prompt.length);
      try { return await inner.json(call); } catch (e) { errors.push((e as Error).message.slice(0, 160)); throw e; }
    },
  };
  setLLM(spy);
  const t0 = Date.now();
  let line: string;
  try {
    const r = await tailorResume(input);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const changed = r.changes.length;
    line = `| ${model} | ${r.usedLLM ? "yes" : "no, fell back to rules"} | ${sizes.length ? sizes.join(" > ") : "n/a"} | ${secs}s | ${changed} of ${bulletCount} | ${r.rejected.length} | ${errors[0] ?? ""} |`;
    console.log(`${model}: used model ${r.usedLLM}; prompt sizes ${sizes.join(" > ") || "-"}; ${secs}s; ${changed}/${bulletCount} lines changed; ${r.rejected.length} rejected`);
    for (const x of r.rejected) console.log(`   rejected ${x.bulletId}: ${x.reason}`);
    for (const c of r.changes.slice(0, 4)) console.log(`   ${c.bulletId}: ${c.after}`);
    console.log(`   summary: ${r.content.summary}`);
  } catch (e) {
    line = `| ${model} | error | ${sizes.join(" > ")} | ${((Date.now() - t0) / 1000).toFixed(0)}s | - | - | ${(e as Error).message.slice(0, 160)} |`;
    console.log(`${model}: ERROR ${(e as Error).message}`);
  }
  rows.push(line);
  setLLM(null);
}

const md = ["# Tailoring check", "", `Run ${new Date().toISOString().slice(0, 16)}Z. Sample resume (${bulletCount} bullets) tailored to a Senior Full-Stack Engineer posting.`, "",
  "| Model | Used the model | Prompt sizes (chars) | Time | Lines changed | Rejected as untrue | First error |", "|---|---|---|---|---|---|---|", ...rows, ""].join("\n");
await mkdir(path.join(ROOT, "test-results"), { recursive: true });
await writeFile(path.join(ROOT, "test-results/tailor-eval.md"), md);
process.exit(0);
