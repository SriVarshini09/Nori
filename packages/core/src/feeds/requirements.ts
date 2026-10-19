import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { jobs, type JobRequirements } from "../db/schema.js";
import { canonicalSkill, findSkills } from "../graph/skills.js";
import { getLLM, withFallback } from "../llm/index.js";

const SENIORITIES = ["intern", "junior", "mid", "senior", "staff", "lead", "executive", "unknown"] as const;

export const JobRequirementsSchema = z.object({
  skills: z.array(z.object({ name: z.string(), required: z.boolean() })),
  seniority: z.enum(SENIORITIES),
  roleFamily: z.string(),
  yearsMin: z.number().nullable(),
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  disqualifiers: z.array(z.string()),
  keywords: z.array(z.string()),
  summary: z.string(),
});

// ---------- heuristic ----------
const MUST_HEADING = /^(?:#+\s*)?(?:minimum |basic |required )?(requirements?|what you['’]?ll need|what you['’]?ll bring|what we['’]?re looking for|qualifications|you have|you bring|who you are|must[- ]haves?|skills(?: and experience)?)\b/i;
const NICE_HEADING = /^(?:#+\s*)?(nice[- ]to[- ]haves?|bonus(?: points)?|preferred(?: qualifications| skills)?|great to have|a plus|extra credit|it['’]?s a plus)\b/i;
const OTHER_HEADING = /^(?:#+\s*)?(about\b|responsibilities|what you['’]?ll do|the role|the job|your role|benefits|perks|compensation|salary|why |who we are|our (?:team|mission|story)|how we|equal opportunity|interview|location|overview|description)/i;
const DISQUALIFIER_RE = /must be (?:located|based|residing|living|authorized|eligible)|no (?:visa )?sponsorship|(?:unable|not able|cannot|can['’]?t|do not|don['’]?t|will not|won['’]?t) (?:to )?(?:offer |provide )?(?:visa )?sponsor|sponsorship (?:is )?not (?:available|offered|provided)|\bon[- ]?site\b|security clearance|(?:u\.?s\.?|us) citizen/i;
const STOP_CAPS = new Set(["The", "We", "You", "Our", "Your", "And", "For", "With", "This", "That", "Are", "Will", "Not", "But", "USA", "EEO", "FAQ", "PTO", "HR", "CEO", "CTO", "VP", "US", "UK", "EU", "OK", "AM", "PM", "LLC", "INC", "ETC", "NOT", "ALL", "ANY", "AND", "THE", "FOR", "WHO", "WHAT", "WHY", "YOU", "OUR", "WE"]);

function bulletText(line: string): string {
  return line.replace(/^\s*(?:[-•*·▪●◦]|\d+[.)])\s*/, "").trim();
}

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/^[-•*·]\s/.test(t) || /[.!?]$/.test(t)) return false;
  return MUST_HEADING.test(t) || NICE_HEADING.test(t) || OTHER_HEADING.test(t);
}

export function sectionize(text: string): { must: string[]; nice: string[] } {
  const must: string[] = [], nice: string[] = [];
  let mode: "must" | "nice" | null = null;
  let sawBullet = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeadingLine(line)) {
      mode = NICE_HEADING.test(line) ? "nice" : MUST_HEADING.test(line) ? "must" : null;
      sawBullet = false;
      const inline = line.split(":").slice(1).join(":").trim(); // "Nice to have: Rust"
      if (mode && inline.length >= 6) (mode === "must" ? must : nice).push(inline.slice(0, 300));
      continue;
    }
    if (!mode) continue;
    const isBullet = bulletText(line) !== line;
    if (isBullet) sawBullet = true;
    else if (sawBullet) { mode = null; continue; } // prose after a bullet list ends the section
    const b = bulletText(line);
    if (b.length < 6) continue;
    (mode === "must" ? must : nice).push(b.slice(0, 300));
  }
  return { must: must.slice(0, 15), nice: nice.slice(0, 15) };
}

export function inferSeniority(title: string): JobRequirements["seniority"] {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "intern";
  if (/\b(vp|vice president|director|head of|chief|cto|cio|ciso)\b/.test(t)) return "executive";
  if (/\b(staff|principal|distinguished|fellow)\b/.test(t)) return "staff";
  if (/\b(lead|engineering manager)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)(?=\W|$)/.test(t)) return "senior";
  if (/\b(junior|jr\.?|entry[- ]level|new grad|graduate|associate)(?=\W|$)/.test(t)) return "junior";
  return "unknown";
}

export function inferRoleFamily(title: string): string {
  const t = title.toLowerCase();
  const rules: [RegExp, string][] = [
    [/front[- ]?end|\bui\b|web developer/, "frontend"],
    [/full[- ]?stack/, "fullstack"],
    [/back[- ]?end|server[- ]side|api engineer/, "backend"],
    [/machine learning|\bml\b|\bai\b|data scien|research scien|applied scien/, "data-ml"],
    [/data (engineer|analyst|platform)|analytics/, "data"],
    [/devops|\bsre\b|reliability|platform|infrastructure|cloud engineer/, "infrastructure"],
    [/mobile|\bios\b|android/, "mobile"],
    [/security|appsec/, "security"],
    [/design|ux\b/, "design"],
    [/product manager|product management|\bpm\b/, "product"],
    [/sales|account executive|business development|customer success/, "sales"],
    [/marketing|growth|content|seo/, "marketing"],
    [/recruit|talent|people ops|human resources|\bhr\b/, "people"],
    [/engineer|developer|programmer|software/, "engineering"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? "other";
}

function inferYearsMin(text: string, mustLines: string[]): number | null {
  const re = /(\d{1,2})\s*(?:\+|-\s*\d{1,2}|to\s*\d{1,2})?\s*(?:years?|yrs?)\b([^.\n]{0,80})/gi;
  const scan = (s: string): number[] => {
    const out: number[] = [];
    for (const m of s.matchAll(re)) {
      if (!/experience|exp\b|working|professional|developing|building|engineering|\bin\b|\bwith\b|\bof\b/i.test(m[2])) continue;
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 30) out.push(n);
    }
    return out;
  };
  const inMust = scan(mustLines.join("\n"));
  const all = inMust.length ? inMust : scan(text);
  return all.length ? Math.min(...all) : null;
}

function distinctiveTerms(text: string, exclude: Set<string>): string[] {
  const counts = new Map<string, number>();
  const re = /\b(?:[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[A-Z]{2,}[a-z0-9]*|[A-Z][a-z]+[0-9]+)\b/g;
  for (const m of text.matchAll(re)) {
    const w = m[0];
    if (STOP_CAPS.has(w) || exclude.has(w.toLowerCase())) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 10);
}

export function heuristicRequirements(job: { title: string; descriptionText: string }): JobRequirements {
  const text = job.descriptionText ?? "";
  const { must, nice } = sectionize(text);
  const allSkills = findSkills(`${job.title}\n${text}`);
  const niceOnly = new Set(findSkills(nice.join("\n")).map((s) => s.toLowerCase()));
  const nonNice = new Set(findSkills(`${job.title}\n${text.split("\n").filter((l) => !nice.some((n) => l.includes(n))).join("\n")}`).map((s) => s.toLowerCase()));
  const skills = allSkills.map((name) => ({
    name,
    required: nonNice.has(name.toLowerCase()) || !niceOnly.has(name.toLowerCase()),
  }));
  skills.sort((a, b) => Number(b.required) - Number(a.required));

  const disqualifiers: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = bulletText(sentence);
    if (s.length > 6 && s.length <= 240 && DISQUALIFIER_RE.test(s) && !disqualifiers.includes(s)) disqualifiers.push(s);
    if (disqualifiers.length >= 6) break;
  }

  const yearsMin = inferYearsMin(text, must);
  let seniority = inferSeniority(job.title);
  if (seniority === "unknown" && yearsMin != null) seniority = yearsMin <= 1 ? "junior" : yearsMin <= 4 ? "mid" : "senior";

  const top = skills.slice(0, 15).map((s) => s.name);
  const exclude = new Set(allSkills.map((s) => s.toLowerCase()));
  const keywords = [...top, ...distinctiveTerms(text, exclude)];

  return {
    skills,
    seniority,
    roleFamily: inferRoleFamily(job.title),
    yearsMin,
    mustHaves: must,
    niceToHaves: nice,
    disqualifiers,
    keywords: [...new Set(keywords)],
    summary: text.replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

// ---------- LLM ----------
function normalizeLLM(r: z.infer<typeof JobRequirementsSchema>): JobRequirements {
  const seen = new Set<string>();
  const skills = r.skills
    .map((s) => {
      const c = canonicalSkill(s.name);
      return { name: typeof c === "string" && c ? c : s.name.trim(), required: s.required };
    })
    .filter((s) => s.name && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()));
  return {
    skills,
    seniority: r.seniority,
    roleFamily: r.roleFamily || "other",
    yearsMin: r.yearsMin != null && r.yearsMin >= 0 ? Math.round(r.yearsMin) : null,
    mustHaves: r.mustHaves.slice(0, 15),
    niceToHaves: r.niceToHaves.slice(0, 15),
    disqualifiers: r.disqualifiers.slice(0, 8),
    keywords: [...new Set(r.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 30),
    summary: r.summary.slice(0, 600),
  };
}

export async function extractRequirements(job: { title: string; descriptionText: string }): Promise<{ requirements: JobRequirements; usedLLM: boolean }> {
  const { value, usedLLM } = await withFallback<JobRequirements>(
    async () => {
      const r = await getLLM("bulk").json({
        name: "job_requirements",
        system:
          "You extract structured hiring requirements from a job posting. Only use information present in the posting. " +
          "skills: concrete technologies, tools, and competencies, each marked required or nice-to-have. " +
          "seniority: one of intern, junior, mid, senior, staff, lead, executive, unknown. " +
          "yearsMin: the minimum years of experience required, or null. " +
          "mustHaves / niceToHaves: short sentences. disqualifiers: hard constraints such as location, on-site, work authorization or no sponsorship. " +
          "keywords: terms an ATS would match on. summary: at most 300 characters.",
        prompt: `Title: ${job.title}\n\nDescription:\n${job.descriptionText.slice(0, 12_000)}`,
        schema: JobRequirementsSchema,
        maxTokens: 4000,
        effort: "low",
      });
      return normalizeLLM(r);
    },
    () => heuristicRequirements(job),
    "extractRequirements",
    "bulk",
  );
  return { requirements: value, usedLLM };
}

/** Compute and store jobs.requirements if it is still null. Returns the requirements, or null if the job does not exist. */
export async function ensureRequirements(db: Db, jobId: string): Promise<JobRequirements | null> {
  const [row] = await db.select({ title: jobs.title, descriptionText: jobs.descriptionText, requirements: jobs.requirements })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!row) return null;
  if (row.requirements) return row.requirements;
  const { requirements } = await extractRequirements(row);
  await db.update(jobs).set({ requirements }).where(eq(jobs.id, jobId));
  return requirements;
}
