/**
 * `npm run dryrun:live [url ...]`: opens one REAL public job application page per platform, fills the form with an
 * obviously fake test person, takes a screenshot and stops. It NEVER submits:
 *   - the script removes ALLOW_REAL_SUBMIT from its environment and refuses to start if it is still "true";
 *   - every run passes dryRun: true, and the drivers refuse to click submit unless dryRun is false AND the variable is "true".
 * It creates no account and uses no real person's data. With no URLs given it picks one posting per platform from the
 * public job feeds. Writes test-results/live-dryrun/report.md and one screenshot per platform.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_REGISTRY, makeAnswerQuestion, type ApplicantProfile, type DriverContext } from "@jobgraph/core";
import { pickDriver } from "@jobgraph/drivers";

delete process.env.ALLOW_REAL_SUBMIT;
if (process.env.ALLOW_REAL_SUBMIT === "true") throw new Error("Refusing to run: ALLOW_REAL_SUBMIT is true");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test-results/live-dryrun");

const ME: ApplicantProfile = {
  fullName: "Nori Dryrun", firstName: "Nori", lastName: "Dryrun", email: "nori.dryrun@example.com", phone: "+1 415 555 0100",
  linkedin: "https://www.linkedin.com/in/nori-dryrun", website: "https://example.com", location: "San Francisco, CA", country: "US",
  workAuth: { authorizedUS: true, needsSponsorship: false },
};

type Ats = "greenhouse" | "lever" | "ashby" | "smartrecruiters";
const get = async (url: string) => {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "NoriDryRun/1.0" }, signal: AbortSignal.timeout(20_000) });
  return r.ok ? ((await r.json()) as any) : null;
};
const firstPosting: Record<Ats, (t: string) => Promise<string | null>> = {
  greenhouse: async (t) => (await get(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs`))?.jobs?.[0]?.absolute_url ?? null,
  lever: async (t) => (await get(`https://api.lever.co/v0/postings/${t}?mode=json&limit=1`))?.[0]?.hostedUrl ?? null,
  ashby: async (t) => (await get(`https://api.ashbyhq.com/posting-api/job-board/${t}`))?.jobs?.find((j: any) => j.isListed !== false)?.jobUrl ?? null,
  smartrecruiters: async (t) => {
    const j = (await get(`https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=1`))?.content?.[0];
    return j ? `https://jobs.smartrecruiters.com/${t}/${j.id}` : null;
  },
};

async function pick(ats: Ats): Promise<string> {
  for (const b of BOARD_REGISTRY.filter((x) => x.atsType === ats)) {
    const url = await firstPosting[ats](b.token).catch(() => null);
    if (url) return url;
  }
  throw new Error(`no ${ats} posting found`);
}

const urls = process.argv.slice(2).length ? process.argv.slice(2) : await Promise.all((["greenhouse", "lever", "ashby", "smartrecruiters"] as Ats[]).map(pick));
await mkdir(OUT, { recursive: true });
const resume = path.join(OUT, "dummy-resume.pdf");
await copyFile(path.join(ROOT, "packages/core/src/resume/fixtures/alex-chen-links.pdf"), resume);

const rows: string[] = [];
for (const url of urls) {
  const driver = pickDriver(url);
  const label = driver?.atsType ?? "none";
  console.log(`\n=== ${label}: ${url}`);
  if (!driver) { rows.push(`| ${label} | ${url} | no driver | | | |`); continue; }
  const dir = path.join(OUT, `${label}-${new URL(url).hostname.replace(/\W+/g, "-")}`);
  await mkdir(dir, { recursive: true });
  const events: string[] = [];
  const ctx: DriverContext = {
    applyUrl: url, profile: ME, resumePdfPath: resume, answers: {},
    // The real answer logic with no model (this script loads no keys): profile answers and rule-based fallbacks only.
    answerQuestion: makeAnswerQuestion({ profile: { ...ME, city: "San Francisco", state: "CA", pronouns: "they/them" }, evidence: [], jobTitle: "Test role", companyName: "Test company", composed: {}, education: [] }),
    waitForCode: async () => null,
    dryRun: true,
    onEvent: (step, message) => { events.push(`${step}: ${message}`); },
    artifactsDir: dir, headless: true,
  };
  const t0 = Date.now();
  const res = await Promise.race([
    driver.run(ctx),
    new Promise<{ outcome: "failed"; error: string }>((r) => setTimeout(() => r({ outcome: "failed", error: "timed out after 150 s" }), 150_000)),
  ]).catch((e: Error) => ({ outcome: "failed" as const, error: e.message }));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (res.outcome === "submitted") throw new Error("A dry run reported a submission. Stopping.");

  const fields = "receipt" in res ? res.receipt.fields : [];
  const pending = res.outcome === "needs_user" ? res.pending : [];
  const shot = "receipt" in res ? res.receipt.screenshotPath : (res as any).screenshotPath;
  console.log(`outcome: ${res.outcome} (${secs}s) | filled ${fields.length} field(s) | ${pending.length} pending${"error" in res ? ` | error: ${res.error}` : ""}`);
  for (const f of fields) console.log(`  filled  ${f.label}: ${String(f.value).slice(0, 60)}`);
  for (const p of pending) console.log(`  asks    ${p.label}${p.required ? " (required)" : ""}`);
  rows.push(`| ${label} | ${url} | ${res.outcome}${"error" in res ? `: ${res.error}` : ""} | ${fields.length} | ${pending.map((p) => p.label).join("; ").slice(0, 200)} | ${shot ? path.relative(ROOT, shot).replace(/\\/g, "/") : ""} |`);
}

await writeFile(path.join(OUT, "report.md"), [
  "# Live dry run (nothing submitted)", "", `Run ${new Date().toISOString().slice(0, 16)}Z with a fake test person; no account, no submit.`, "",
  "| Driver | Posting | Outcome | Fields filled | Still asks | Screenshot |", "|---|---|---|---|---|---|", ...rows, "",
].join("\n"));
process.exit(0);
