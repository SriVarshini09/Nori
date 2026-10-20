#!/usr/bin/env node
/**
 * The quality gate. Every change must pass this before it is committed:
 *   node scripts/gate.mjs          typecheck, unit tests, lint, production web build, crawl of every route and link, browser end-to-end journey
 *   node scripts/gate.mjs --fast   skip the web build, the crawl and the end-to-end journey
 *   node scripts/gate.mjs --only typecheck,tests
 * Exit code 0 only when every step passed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fast = args.includes("--fast");
const onlyArg = args.indexOf("--only");
const only = onlyArg >= 0 ? new Set((args[onlyArg + 1] ?? "").split(",")) : null;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const STEPS = [
  { id: "typecheck", label: "TypeScript", cmd: npm, args: ["run", "typecheck"] },
  { id: "tests", label: "Unit and API tests", cmd: npx, args: ["vitest", "run"] },
  { id: "lint", label: "Lint (web)", cmd: npm, args: ["run", "lint", "--workspace", "apps/web"] },
  {
    id: "build", label: "Web production build (live mode)", cmd: npm, args: ["run", "build", "--workspace", "apps/web"], skipWhenFast: true,
    env: { NEXT_PUBLIC_USE_MOCK: "0", API_URL: "http://localhost:4200", NEXT_TELEMETRY_DISABLED: "1" },
  },
  { id: "crawl", label: "Route, link and console crawl", cmd: npx, args: ["tsx", "scripts/crawl.mts"], skipWhenFast: true },
  { id: "e2e", label: "Browser end-to-end journey", cmd: npm, args: ["run", "e2e"], skipWhenFast: true },
];

const results = [];
for (const s of STEPS) {
  if (only && !only.has(s.id)) continue;
  if (fast && s.skipWhenFast && !only) { results.push({ ...s, status: "skipped", ms: 0 }); continue; }
  process.stdout.write(`\n=== ${s.label} ===\n`);
  const t = Date.now();
  const r = spawnSync(s.cmd, s.args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...(s.env ?? {}) } });
  results.push({ ...s, status: r.status === 0 ? "pass" : "FAIL", ms: Date.now() - t });
  if (r.status !== 0) break;
}

console.log("\n--- gate summary ---");
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.label.padEnd(36)} ${(r.ms / 1000).toFixed(1)}s`);
const failed = results.some((r) => r.status === "FAIL");
console.log(failed ? "\nGATE FAILED" : "\nGATE PASSED");
process.exit(failed ? 1 : 0);
