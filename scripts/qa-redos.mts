/**
 * ReDoS harness: feeds hostile text to every text-parsing function that handles user or third-party input and times it.
 *   npx tsx scripts/qa-redos.mts                 runs everything in child processes (a hang is killed and reported)
 *   npx tsx scripts/qa-redos.mts --one <name>    internal: runs one function over every pattern
 * A pattern taking over 400 ms at the tested size is reported as SLOW: it grows fast with input size, which is how a pasted
 * resume or a hostile job posting freezes a server.
 */
import { spawnSync } from "node:child_process";

const N = Number(process.env.REDOS_SIZE ?? 60_000);
const rep = (s: string, n = N) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const PATTERNS: Record<string, string> = {
  "long word": rep("x"),
  "dotted word": rep("a."),
  "dashed word": rep("a-"),
  "digits and spaces": rep("1 "),
  "digits and dashes": rep("1-"),
  "phone-ish": rep("(555) 123-"),
  "at signs": rep("a@"),
  "email-ish": rep("a.b@c-d."),
  "url-ish": rep("http://a."),
  "www dots": rep("www.a-b."),
  "slashes": rep("/"),
  "brackets": rep("("),
  "years": rep("5 years "),
  "years plus": rep("5+ "),
  "dollars": rep("$1,000-"),
  "range": rep("1k-2k to "),
  "dates": rep("Jan 2020 - "),
  "bullets": rep("- "),
  "newlines": rep("\n"),
  "mixed newline word": rep("word\n"),
  "capitalised words": rep("Alice "),
  "html tags": rep("<p>"),
  "html unclosed": rep("<a href=\""),
  "entities": rep("&amp;"),
  "unicode": rep("é́"),
  "spaces": rep(" "),
  "tabs and spaces": rep(" \t"),
  "quotes": rep("\""),
  "label colon": rep("linkedin: "),
  "linkedin url": rep("linkedin.com/in/"),
};

const TARGETS: Record<string, () => Promise<(s: string) => unknown>> = {
  extractContact: async () => { const m = await import("../packages/core/src/resume/contact.js"); return (s) => m.extractContact(s); },
  parseResumeHeuristic: async () => { const m = await import("../packages/core/src/graph/parse.js"); return (s) => m.parseResumeHeuristic(s, []); },
  heuristicRequirements: async () => { const m = await import("../packages/core/src/feeds/requirements.js"); return (s) => m.heuristicRequirements({ title: "Senior Engineer", descriptionText: s }); },
  checkDisqualifiers: async () => { const m = await import("../packages/core/src/agent/gate.js"); return (s) => m.checkDisqualifiers({ companyName: "Acme", title: "Engineer", location: "Remote", descriptionText: s }, null, { workAuth: { status: "visa", needsSponsorship: true }, location: "San Francisco, CA" }); },
  parseSalaryRange: async () => { const m = await import("../packages/core/src/agent/gate.js"); return (s) => m.parseSalaryRange(s); },
  htmlToText: async () => { const m = await import("../packages/core/src/feeds/html.js"); return (s) => m.htmlToText(s); },
  titleMatches: async () => { const m = await import("../packages/core/src/agent/lanes.js"); return (s) => m.titleMatches(s, "Senior Frontend Engineer"); },
  findSkills: async () => { const m = await import("../packages/core/src/graph/skills.js"); return (s) => m.findSkills(s); },
  extractMetrics: async () => { const m = await import("../packages/core/src/graph/metrics.js"); return (s) => m.extractMetrics(s); },
};

const arg = process.argv.indexOf("--one");
if (arg >= 0) {
  const name = process.argv[arg + 1];
  const fn = await TARGETS[name]();
  for (const [label, text] of Object.entries(PATTERNS)) {
    process.stdout.write(`START ${label}\n`);
    const t = performance.now();
    try { fn(text); } catch { /* throwing is fine; hanging is not */ }
    process.stdout.write(`DONE ${label} ${Math.round(performance.now() - t)}\n`);
  }
  process.exit(0);
}

let bad = 0;
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const name of Object.keys(TARGETS)) {
  if (only.length && !only.includes(name)) continue;
  const r = spawnSync(process.execPath, ["--import", "tsx", process.argv[1], "--one", name], { encoding: "utf8", timeout: 60_000, env: process.env });
  const lines = (r.stdout ?? "").split("\n").filter(Boolean);
  const slow: string[] = [];
  for (const l of lines) { const m = /^DONE (.+) (\d+)$/.exec(l); if (m && Number(m[2]) > 400) slow.push(`${m[1]} ${m[2]}ms`); }
  const hung = r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const last = [...lines].reverse().find((l) => l.startsWith("START"))?.slice(6);
  if (hung) { bad++; console.log(`HANG  ${name}: stuck on "${last}" (killed after 60 s)`); }
  else if (slow.length) { bad++; console.log(`SLOW  ${name}: ${slow.join(", ")}`); }
  else console.log(`ok    ${name} (${lines.filter((l) => l.startsWith("DONE")).length} patterns at ${N} chars)`);
}
console.log(bad ? `\n${bad} function(s) with a ReDoS problem` : "\nno ReDoS problems found");
process.exit(bad ? 1 : 0);
