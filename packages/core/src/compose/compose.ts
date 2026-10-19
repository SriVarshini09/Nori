import { z } from "zod";
import type { Evidence, FormField } from "../contracts.js";
import type { CompanyResearch, JobRequirements, Preferences, ResumeContent, SalaryExpectation } from "../db/schema.js";
import { getLLM, withFallback } from "../llm/index.js";
import { ALL_SKILLS, canonicalSkill } from "../graph/skills.js";
import { NARRATIVE_KINDS, NEVER_COMPOSE, isLongForm, type QuestionKind } from "./classify.js";
import { LONG_MAX_WORDS, LONG_MIN_WORDS, VOICE_SYSTEM, lint, onlyLengthIssues, wordCount, type LintMode } from "./voice.js";

export type ComposeJob = {
  /** Seeds the template variant so answers differ across applications. */
  id?: string;
  title: string;
  companyName: string;
  descriptionText: string;
  requirements: JobRequirements | null;
};

export type ComposeProfile = {
  fullName: string;
  preferences?: Preferences | Record<string, unknown> | null;
  salaryExpectation?: SalaryExpectation;
  earliestStartDate?: string;
  noticePeriodWeeks?: number;
  willingToRelocate?: boolean;
  location?: string;
  website?: string;
  github?: string;
  remotePreference?: string;
};

export type ComposeInput = {
  kind: QuestionKind;
  label: string;
  field: Pick<FormField, "kind" | "required"> & Partial<FormField>;
  job: ComposeJob;
  research: CompanyResearch | null;
  evidence: Evidence[];
  profile: ComposeProfile;
  baseline: ResumeContent;
};

export type ComposeResult = { answer: string | null; usedLLM: boolean; sources: string[] };

/** Short, factual kinds are always answered from the profile; the LLM adds nothing there. */
const LLM_KINDS = new Set<QuestionKind>([...NARRATIVE_KINDS, "unknown"]);

/**
 * Answer a free-text application question in the applicant's own voice. LLM when configured (one structured
 * call, linted, one retry), else deterministic templates that still read like a person typed them.
 * Returns answer null only when the agent must not or cannot answer (legal ids, references, no website,
 * unknown questions with no relevant evidence); "" means leave an optional field blank.
 */
export async function composeAnswer(input: ComposeInput): Promise<ComposeResult> {
  if (NEVER_COMPOSE.has(input.kind)) return { answer: null, usedLLM: false, sources: [] };
  const facts = buildFacts(input);
  const heuristic = () => heuristicCompose(input, facts);
  if (!LLM_KINDS.has(input.kind)) return { ...heuristic(), usedLLM: false };
  if (input.kind === "anything_else" && !input.field.required) return { answer: "", usedLLM: false, sources: [] };
  if (input.kind === "unknown" && !facts.relevant.length) return { ...heuristic(), usedLLM: false };
  const { value, usedLLM } = await withFallback(() => llmCompose(input, facts), heuristic, `composeAnswer(${input.kind})`, "quality");
  return { ...value, usedLLM };
}

// ---------- shared facts ----------

type Story = {
  nodeId: string;
  statement: string;
  company?: string;
  roleId?: string;
  roleTitle?: string;
  project?: string;
  reqs: Set<string>;
  maxNum: number;
  score: number;
};

type Facts = {
  /** Requirements the user has evidence for, best first. */
  matched: string[];
  /** Requirements with no evidence at all. */
  missing: string[];
  /** Metric stories, best first. */
  stories: Story[];
  /** role id -> requirements that role covers (skills used there). */
  roleSkills: Map<string, string[]>;
  /** Project rows (label + node id + company) from the evidence. */
  projects: { nodeId: string; label: string; company?: string; roleId?: string }[];
  /** Evidence rows that share words with the question (for unknown kinds). */
  relevant: Evidence[];
  /** Top evidence rows, deduped by node, for the LLM prompt. */
  top: Evidence[];
  current?: { company: string; title: string; start?: string };
};

const STOP = new Set("a an and are as at be by can could describe do does for from have how i if in is it me my of on or our please share should tell that the their this to us we what when where which who why will with would you your yourself experience".split(" "));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*/g) ?? [];
const firstNumbers = (s: string) => [...s.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const roleTitleOf = (label?: string, company?: string) => {
  if (!label) return undefined;
  let t = label.replace(/\s*\(.*?\)\s*$/, "");
  if (company) t = t.replace(new RegExp(`\\s*(,|at|@|-|\\|)\\s*${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  return t.trim() || undefined;
};

function buildFacts(input: ComposeInput): Facts {
  const { evidence, baseline, job, label } = input;
  const byNode = new Map<string, { row: Evidence; reqs: Set<string>; score: number }>();
  const reqScore = new Map<string, number>();
  const roleSkills = new Map<string, string[]>();
  for (const e of evidence) {
    const g = byNode.get(e.nodeId);
    if (g) { g.reqs.add(e.requirement); if (e.score > g.score) { g.score = e.score; g.row = e; } }
    else byNode.set(e.nodeId, { row: e, reqs: new Set([e.requirement]), score: e.score });
    const backed = e.nodeType === "role" || e.nodeType === "project" || e.nodeType === "metric";
    const s = e.score + (backed ? 1 : 0);
    reqScore.set(e.requirement, Math.max(reqScore.get(e.requirement) ?? 0, s));
    if (e.roleId && (e.nodeType === "role" || e.nodeType === "project")) {
      const list = roleSkills.get(e.roleId) ?? roleSkills.set(e.roleId, []).get(e.roleId)!;
      if (!list.includes(e.requirement) && e.requirement.length <= 30) list.push(e.requirement);
    }
  }
  // Narrative skill order: technical skills by evidence strength. Soft skills (mentoring, communication...) only
  // when nothing technical matched, so an answer never leads with "Mentoring and TypeScript".
  const ranked = [...reqScore.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).filter((r) => r.length <= 40);
  const tech = ranked.filter((r) => !isSoftSkill(r));
  const matched = tech.length ? tech : ranked;
  if (tech.length) for (const [id, list] of roleSkills) roleSkills.set(id, list.filter((r) => !isSoftSkill(r)));

  const reqs = job.requirements;
  const wanted = reqs ? [...reqs.skills.map((s) => s.name), ...reqs.mustHaves] : [];
  const have = new Set(matched.map((m) => m.toLowerCase()));
  const missing = wanted.filter((w) => w.length <= 30 && !have.has(w.toLowerCase()));

  // Projects and companies from the baseline resume (the graph's own view) for context on metrics.
  const projectOf = new Map<string, string>();
  for (const p of baseline.projects ?? []) for (const b of p.bullets) for (const id of b.nodeIds) projectOf.set(id, p.name);
  const companyOf = new Map<string, { company: string; title: string }>();
  for (const x of baseline.experience) for (const b of x.bullets) for (const id of b.nodeIds) companyOf.set(id, { company: x.company, title: x.title });

  const stories: Story[] = [];
  for (const { row, reqs: rs, score } of byNode.values()) {
    if (row.nodeType !== "metric" || !/\d/.test(row.text)) continue;
    const nums = firstNumbers(row.text);
    const company = row.companyLabel ?? companyOf.get(row.nodeId)?.company;
    stories.push({
      nodeId: row.nodeId, statement: cleanStatement(row.text), company, roleId: row.roleId,
      roleTitle: companyOf.get(row.nodeId)?.title ?? roleTitleOf(row.roleLabel, company),
      project: projectOf.get(row.nodeId), reqs: rs, maxNum: nums.length ? Math.max(...nums) : 0, score,
    });
  }
  // No metric evidence for this job: fall back to any numeric bullet on the baseline resume.
  if (!stories.length) {
    for (const x of baseline.experience) for (const b of x.bullets) {
      if (!/\d/.test(b.text) || !b.nodeIds.length) continue;
      const nums = firstNumbers(b.text);
      stories.push({ nodeId: b.nodeIds[0], statement: cleanStatement(b.text), company: x.company, roleTitle: x.title, project: projectOf.get(b.nodeIds[0]), reqs: new Set(), maxNum: nums.length ? Math.max(...nums) : 0, score: 0 });
    }
  }
  const rank = (s: Story) => s.reqs.size * 2 + (s.roleId ? (roleSkills.get(s.roleId)?.length ?? 0) * 0.5 : 0) + Math.log10(s.maxNum + 1) + s.score;
  stories.sort((a, b) => rank(b) - rank(a));

  const projects: Facts["projects"] = [];
  for (const { row } of byNode.values()) if (row.nodeType === "project") projects.push({ nodeId: row.nodeId, label: row.label, company: row.companyLabel, roleId: row.roleId });

  const qWords = new Set(words(label).filter((w) => w.length >= 3 && !STOP.has(w)));
  const relevant = qWords.size
    ? [...byNode.values()].map((g) => g.row).filter((e) => words(`${e.requirement} ${e.label} ${e.text}`).some((w) => qWords.has(w)))
    : [];

  const top = [...byNode.values()].sort((a, b) => b.score - a.score).map((g) => g.row).slice(0, 8);
  const cur = baseline.experience.find((x) => x.end === "Present") ?? baseline.experience[0];
  return {
    matched, missing, stories, roleSkills, projects, relevant, top,
    current: cur ? { company: cur.company, title: cur.title, start: cur.start } : undefined,
  };
}

const cleanStatement = (s: string) => s.trim().replace(/^[•\-*]\s*/, "").replace(/[.;\s]+$/, "");

// ---------- LLM path ----------

const OutSchema = z.object({
  answer: z.string().describe("The answer text exactly as it should be typed into the form."),
  sourcesUsed: z.array(z.string()).describe("nodeIds of the evidence rows the answer relies on."),
});

function lintMode(input: ComposeInput): LintMode {
  return isLongForm(input.kind, input.field) ? "long" : "short";
}

function researchBlock(r: CompanyResearch | null): string {
  if (!r || /^research unavailable/i.test(r.summary)) return "(no research available; use only the job description for company facts)";
  return [
    `Summary: ${r.summary}`,
    r.stage ? `Stage: ${r.stage}` : "", r.funding ? `Funding: ${r.funding}` : "", r.headcount ? `Headcount: ${r.headcount}` : "",
    r.recentNews?.length ? `Recent news:\n${r.recentNews.slice(0, 5).map((n) => `- ${n}`).join("\n")}` : "",
    r.citations.length ? `Citations:\n${r.citations.slice(0, 8).map((c) => `- [${c.field}] ${c.title ?? ""} ${c.url}`.trim()).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

async function llmCompose(input: ComposeInput, facts: Facts): Promise<{ answer: string | null; sources: string[] }> {
  const { job, kind, label } = input;
  const mode = lintMode(input);
  const req = job.requirements;
  const evidenceRows = (facts.top.length ? facts.top : []).map((e) =>
    `- nodeId=${e.nodeId} [${e.nodeType}] ${e.text}${e.roleLabel ? ` | role: ${e.roleLabel}` : ""}${e.companyLabel ? ` | company: ${e.companyLabel}` : ""} | matches requirement: ${e.requirement}`);
  const p = input.profile;
  const prompt = [
    `Question (${kind.replace(/_/g, " ")}): ${label}`,
    `Field: ${input.field.kind}${input.field.required ? ", required" : ", optional"}. Length: ${mode === "long" ? `${LONG_MIN_WORDS} to ${LONG_MAX_WORDS} words` : "one or two sentences"}.`,
    `Job: ${job.title} at ${job.companyName}`,
    `Job description (excerpt):\n${job.descriptionText.slice(0, 1500)}`,
    req ? `Requirements: ${[...req.skills.map((s) => `${s.name}${s.required ? " (required)" : ""}`), ...req.mustHaves].slice(0, 20).join("; ")}` : "",
    `Company research:\n${researchBlock(input.research)}`,
    `Applicant: ${p.fullName || "(name unknown)"}${p.location ? `, based in ${p.location}` : ""}${facts.current ? `. Currently ${facts.current.title} at ${facts.current.company}` : ""}`,
    `Career evidence (top ${evidenceRows.length}):\n${evidenceRows.join("\n") || "(none)"}`,
    facts.missing.length ? `Requirements with no evidence (do not claim these): ${facts.missing.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");

  const call = (extra: string) => getLLM("quality").json({ name: "compose_answer", system: VOICE_SYSTEM, prompt: prompt + extra, schema: OutSchema, maxTokens: 1500, effort: "low" });
  let out = await call("");
  let issues = lint(out.answer, mode);
  if (issues.length) {
    out = await call(`\n\nYour previous answer was:\n${out.answer}\n\nIt broke these rules: ${issues.join("; ")}. Rewrite it so it follows every rule.`);
    issues = lint(out.answer, mode);
    if (issues.length && !onlyLengthIssues(issues)) throw new Error(`answer still fails lint: ${issues.join("; ")}`);
  }
  const ids = new Set(input.evidence.map((e) => e.nodeId));
  return { answer: out.answer.trim(), sources: [...new Set(out.sourcesUsed.filter((s) => ids.has(s)))] };
}

// ---------- heuristic path ----------

/** FNV-1a: stable across runs and machines so the same job always gets the same variant. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Which of n template variants this job gets for this kind of question. */
export function variantIndex(job: Pick<ComposeJob, "id" | "companyName" | "title">, kind: QuestionKind, n: number): number {
  return hashString(`${job.id ?? `${job.companyName}|${job.title}`}|${kind}`) % n;
}

const SOFT_SKILL = /\b(mentor\w*|coach\w*|communicat\w*|collaborat\w*|team\s?work|teamwork|team player|problem[- ]solving|leadership|lead(ing)? teams?|interpersonal|time management|adaptab\w*|ownership|stakeholder\w*|presentation|public speaking|critical thinking|attention to detail|creativity|work ethic|empathy|team management|people management|project management)\b/i;
/** Soft skills never lead a narrative answer when a technical skill is available. */
export const isSoftSkill = (s: string) => SOFT_SKILL.test(s);

const SKILL_NAMES = new Set(ALL_SKILLS.map((s) => s.toLowerCase()));
/** Words that must keep their capital: skills (React, Python), companies and products named in the evidence. */
const properNouns = new Set<string>();
function keepsCase(s: string): boolean {
  const words = s.split(/\s+/);
  const first = words[0].replace(/[^\w.+#-]/g, "");
  if (!first || /[.\d+#]/.test(first) || /^[A-Z]{2,}/.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first)) return true;
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const prefix = words.slice(0, n).join(" ").replace(/[^\w.+# -]/g, "").toLowerCase();
    if (SKILL_NAMES.has(prefix) || properNouns.has(prefix)) return true;
    const canon = canonicalSkill(prefix);
    if (canon && canon.toLowerCase() === prefix) return true;
  }
  return false;
}
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !keepsCase(s) ? s[0].toLowerCase() + s.slice(1) : s);
const ucFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s: string) => { const t = s.trim().replace(/\s+/g, " "); return t ? ucFirst(/[.!?]$/.test(t) ? t : `${t}.`) : ""; };
const list2 = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const PAST_VERB = /^(led|built|cut|ran|shipped|grew|made|wrote|drove|won|set|took|taught|sold|kept|broke|rebuilt|founded|owned|designed|launched|reduced|increased|improved|created|developed|implemented|migrated|automated|scaled|mentored|managed|delivered|optimized|optimised|refactored|introduced|established|redesigned|raised|saved|lowered|halved|doubled|tripled|boosted|sped|started|wrapped|moved|replaced|added|helped|worked|partnered|coordinated|organized|organised|published|presented|trained|hired|negotiated|cofounded|co-founded|architected|unified|consolidated)\b/i;

/** "Cut p95 load from 4.2s to 1.1s" -> "I cut p95 load from 4.2s to 1.1s"; null when the bullet does not start with a verb. */
function iDid(statement: string): string | null {
  const s = cleanStatement(statement);
  if (!PAST_VERB.test(s) && !/^\w+ed\b/i.test(s)) return null;
  return `I ${s[0].toLowerCase()}${s.slice(1)}`;
}

type Parsed = { verb: string; object: string; from?: string; to?: string; by?: string; pct?: number; down?: boolean };
function parseStatement(statement: string): Parsed | null {
  const s = cleanStatement(statement);
  let m = s.match(/^(\w+)\s+([^,]+?)\s+from\s+(\$?[\d.,]+\s?[a-z%]{0,4})\s+to\s+(\$?[\d.,]+\s?[a-z%]{0,4})\b/i);
  if (m) {
    const a = firstNumbers(m[3])[0], b = firstNumbers(m[4])[0];
    const pct = a && b !== undefined ? Math.round((Math.abs(a - b) / a) * 100) : undefined;
    return { verb: m[1], object: m[2], from: m[3].trim(), to: m[4].trim(), pct, down: b !== undefined && a !== undefined ? b < a : undefined };
  }
  m = s.match(/^(\w+)\s+([^,]+?)\s+by\s+(\d[\d.,]*\s?(?:%|x|percent))/i);
  if (m) return { verb: m[1], object: m[2], by: m[3].trim(), down: /^(cut|reduc|lower|decreas|shrank|halv|sav|trimm|slash|drop)/i.test(m[1]) };
  return null;
}

/** The thing the story is about, named from the project node label, else the role node (never a sentence fragment). */
function storySubject(st: Story): string {
  if (st.project) return `the ${lcFirst(st.project)}`;
  if (st.roleTitle && st.company) return `a project from my time as ${aOrAn(st.roleTitle)} at ${st.company}`;
  return `a project from ${st.company ?? "my last job"}`;
}

function storySentences(st: Story, facts: Facts, v: number): { problem: string; did: string; outcome: string } {
  const at = st.company ? `At ${st.company}` : "In my last role";
  const p = parseStatement(st.statement);
  const skills = (st.roleId ? facts.roleSkills.get(st.roleId) ?? [] : []).slice(0, 2);
  // The intro already names the project (or the role and company), so the middle sentences do not repeat it.
  let problem: string;
  if (p?.from) {
    const time = /\d\s?(ms|s|sec|secs|seconds|min|mins|minutes|hours|h)\b/i.test(p.from);
    problem = `${at}, our ${lcFirst(p.object)} was sitting at ${p.from}${time && p.down ? ", which is a long time to wait" : ""}`;
  } else if (p?.by) {
    problem = p.down ? `${at}, ${lcFirst(p.object)} was something I really wanted to bring down` : `${at}, the goal was to grow ${lcFirst(p.object)}`;
  } else {
    problem = st.project && st.company ? `This was at ${st.company}${st.roleTitle ? `, where I was ${aOrAn(st.roleTitle)}` : ""}` : "";
  }
  const dids = [
    `I took it on${skills.length ? `, working mostly in ${list2(skills)}` : ""}`,
    `I owned it${skills.length ? ` and did most of it in ${list2(skills)}` : ""}`,
    `I picked it up${skills.length ? `, and ${list2(skills)} were my day-to-day tools there` : ""}`,
  ];
  const did = dids[v % dids.length];
  const done = iDid(st.statement);
  let outcome: string;
  if (p?.from && p.to && p.pct) {
    const time = /\d\s?(ms|s|sec|secs|seconds|min|mins|minutes|hours|h)\b/i.test(p.to);
    outcome = v % 2 === 0 || !time
      ? `I got it ${p.down ? "down" : "up"} to ${p.to}, roughly a ${p.pct}% ${p.down ? "drop" : "jump"}`
      : `By the end it was at ${p.to}, about ${p.pct}% ${p.down ? "faster" : "higher"}`;
  } else outcome = done ? `In the end ${done}` : `The result: ${lcFirst(st.statement)}`;
  return { problem: sentence(problem), did: sentence(did), outcome: sentence(outcome) };
}

/** Join sentences, adding extras (before the closer) until long enough, trimming if too long. */
function fit(core: string[], closer: string | null, extras: Array<string | (() => string)>, mode: LintMode): string {
  const parts = core.filter(Boolean);
  const tail = closer ? [closer] : [];
  if (mode === "short") return [...parts, ...tail].slice(0, 2).join(" ");
  // Extras are lazy so only the sentences actually used record their sources.
  const pool = [...extras];
  while (wordCount([...parts, ...tail].join(" ")) < LONG_MIN_WORDS && pool.length) {
    const next = pool.shift()!;
    const text = typeof next === "function" ? next() : next;
    if (text) parts.push(text);
  }
  while (wordCount([...parts, ...tail].join(" ")) > LONG_MAX_WORDS && parts.length > 2) parts.splice(parts.length - 1, 1);
  return [...parts, ...tail].join(" ");
}

// ----- company hooks -----

type Hook = { text: string; source: string; product?: string; generic?: boolean };

function aboutSentence(job: ComposeJob): string | null {
  const text = job.descriptionText.replace(/\r/g, "");
  const name = job.companyName.trim();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const paras = text.split(/\n\s*\n|\n(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
  let para: string | undefined;
  const aboutIdx = paras.findIndex((p) => new RegExp(`^(about (us|the (company|team)|${esc})|who we are|our mission)\\b`, "i").test(p));
  if (aboutIdx >= 0) {
    const head = paras[aboutIdx].replace(/^[^:\n]*?(about (us|the (company|team)|[^\n:]+)|who we are|our mission)\s*[:\n-]?\s*/i, "");
    para = head.length > 20 && !/^about\b/i.test(head) ? head : paras[aboutIdx + 1];
  }
  // Sentences about the opening itself ("We are hiring a ...") say nothing about the company.
  const HIRING = /\b(hiring|looking for|seeking|searching for|join (our|the) team|this (role|position)|the (role|position)|you will|you'll|requirements?|responsibilit|qualifications?|apply)\b/i;
  const companySentences = (p: string) => p.split(/(?<=[.!?])\s+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 15 && !HIRING.test(x));
  para ??= paras.find((p) => new RegExp(`^(${esc}|at ${esc}|we)\\b`, "i").test(p) && p.length > 40 && companySentences(p).length > 0);
  para ??= paras.find((p) => new RegExp(`\\b${esc}\\b`, "i").test(p) && p.length > 40 && companySentences(p).length > 0);
  if (!para) return null;
  const firstOk = companySentences(para)[0];
  if (!firstOk) return null;
  let first = firstOk.replace(/[.!?]+$/, "");
  const w = first.split(" ");
  const comma = first.indexOf(",");
  if (comma > 0 && first.slice(0, comma).split(" ").length >= 5) first = first.slice(0, comma);
  else if (w.length > 22) {
    const cut = first.search(/,|\s(?:and|which|that|providing|helping|so)\s/);
    first = cut > 30 ? first.slice(0, cut) : w.slice(0, 22).join(" ");
  }
  return first.length >= 15 ? first : null;
}

/** "We build X" -> "You build X" so a JD line reads like the applicant talking to the company. */
function toSecondPerson(s: string): string {
  return s.replace(/\bWe're\b/g, "You're").replace(/\bwe're\b/g, "you're").replace(/\bWe\b/g, "You").replace(/\bwe\b/g, "you")
    .replace(/\bYou are\b/g, "You're").replace(/\bOur\b/g, "Your").replace(/\bour\b/g, "your").replace(/\bus\b/g, "you");
}

function companyHooks(input: ComposeInput, facts: Facts): Hook[] {
  const { research: r, job } = input;
  const name = job.companyName;
  const hooks: Hook[] = [];
  const cite = (field: string) => r?.citations.find((c) => c.field === field)?.url ?? "research";
  if (r && !/^research unavailable|^no summary/i.test(r.summary)) {
    for (const n of r.recentNews ?? []) {
      const t = n.trim().replace(/[.!?]+$/, "");
      if (t.length > 15 && t.split(" ").length <= 30) hooks.push({ text: `I saw that ${lcFirst(t)}, and it made me want to look closer`, source: cite("recentNews") });
    }
    const s = r.summary.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "");
    if (s.length > 15 && s.split(" ").length <= 30) {
      hooks.push(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s)
        ? { text: `${s}, and that's the kind of product I like working on`, source: cite("summary") }
        : { text: `What I know of ${name} is that ${lcFirst(s)}, and that's the kind of product I like working on`, source: cite("summary") });
    }
    if (r.stage && !/unknown/i.test(r.stage)) hooks.push({ text: `${name} being at the ${r.stage.replace(/[.!?]+$/, "")} stage is a big part of the appeal, since there's still a lot left to build`, source: cite("stage") });
  }
  const about = aboutSentence(job);
  if (about) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^${esc}\\b`, "i").test(about)) hooks.push({ text: `${about}, and that's a big part of why I'm applying`, source: "job:description" });
    else if (/^(we|our|at )/i.test(about)) hooks.push({ text: `${toSecondPerson(about.replace(new RegExp(`^at ${esc},?\\s*`, "i"), ""))}, and that's a big part of why I'm applying`, source: "job:description" });
    else hooks.push({ text: `This line from your post stuck with me: "${about}"`, source: "job:description" });
  }
  // A product or tool the post names that the applicant has actually used.
  const desc = job.descriptionText.toLowerCase();
  const product = facts.matched.find((m) => m.length >= 3 && desc.includes(m.toLowerCase()) && /[A-Z.]/.test(m.slice(1)));
  if (product) for (const h of hooks) h.product = product;
  if (!hooks.length) hooks.push({ text: `What stood out in the ${job.title} post was how much of it is about ${list2(facts.matched.slice(0, 2)) || "the actual product"}`, source: "job:description", product, generic: true });
  return hooks;
}

/** First requirement (by evidence strength) the job description names, preferring a product-looking name. */
function overlapReq(input: ComposeInput, facts: Facts): string | undefined {
  const desc = input.job.descriptionText.toLowerCase();
  const inDesc = facts.matched.filter((m) => desc.includes(m.toLowerCase()));
  return inDesc.find((m) => /[A-Z.]/.test(m.slice(1))) ?? inDesc[0] ?? facts.matched[0];
}

function evidenceForReq(facts: Facts, input: ComposeInput, req: string): Evidence | undefined {
  return input.evidence.find((e) => e.requirement === req && (e.nodeType === "role" || e.nodeType === "project"));
}

const roleNoun = (title: string) => (/\bintern(ship)?\b/i.test(title) ? "internship" : "role");
/** "this internship" for intern titles (the title already says intern), else "this Senior Engineer role". */
const thisRole = (title: string) => (/\bintern(ship)?\b/i.test(title) ? "this internship" : `this ${title} role`);

/** A "We are the team behind Next.js" style line from the post that names the requirement, turned to "you". */
function productLine(job: ComposeJob, req: string): string | null {
  const esc = req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sentences = job.descriptionText.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const hit = sentences.find((x) => /^(we|we're|our)\b/i.test(x) && new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(x) && x.split(" ").length <= 16);
  return hit ? toSecondPerson(hit.replace(/[.!?]+$/, "")) : null;
}

// ----- per kind -----

function heuristicCompose(input: ComposeInput, facts: Facts): { answer: string | null; sources: string[] } {
  const { kind, job, profile, field } = input;
  const mode = lintMode(input);
  // Companies, roles and products from the evidence keep their capitals when they start a phrase.
  properNouns.clear();
  for (const n of [job.companyName, ...input.evidence.flatMap((e) => [e.companyLabel, e.nodeType === "skill" || e.nodeType === "tool" ? e.label : undefined])]) {
    const w = n?.trim().split(/\s+/);
    if (w?.length && /^[A-Z]/.test(w[0])) for (let i = 1; i <= Math.min(3, w.length); i++) properNouns.add(w.slice(0, i).join(" ").replace(/[^\w.+# -]/g, "").toLowerCase());
  }
  const sources = new Set<string>();
  const done = (answer: string | null) => ({ answer, sources: [...sources] });
  const company = job.companyName;
  const story = facts.stories[0];
  const second = facts.stories.find((s) => s !== story && s.nodeId !== story?.nodeId);
  const pick = <T,>(xs: T[]) => xs[variantIndex(job, kind, xs.length)];
  const v = variantIndex(job, kind, 4);
  const useStory = (s?: Story) => { if (s) sources.add(s.nodeId); return s; };
  /** One evidence-backed result. `named` is the company the previous sentence already mentioned. */
  const metricLine = (s: Story | undefined, named?: string) => {
    if (!useStory(s)) return "";
    const d = iDid(s!.statement);
    const at = s!.company && s!.company !== named ? ` at ${s!.company}` : named ? " there" : "";
    if (!d) return sentence(`One result I'm proud of${at}: ${lcFirst(s!.statement)}`);
    const did = d.slice(2);
    return sentence([
      `The thing I'm proudest of${at} is that I ${did}`,
      `For example, ${at && at !== " there" ? `${at.trim()}, ` : ""}I ${did}`,
      `Most recently${at ? ` ${at.trim()}` : ""}, I ${did}`,
      `The work I'd point to${at}: I ${did}`,
    ][v]);
  };
  const extraProject = () => {
    const p = facts.projects.find((x) => !story?.project || x.label !== story.project);
    if (!p) return "";
    sources.add(p.nodeId);
    return sentence(`I also worked on the ${lcFirst(p.label)}${p.company ? ` at ${p.company}` : ""}, which taught me a lot about building things other people depend on`);
  };
  const secondLine = () => {
    if (!second) return "";
    sources.add(second.nodeId);
    const d = iDid(second.statement);
    return sentence(d ? `On a different note, ${d}` : `Another one I'm happy with: ${lcFirst(second.statement)}`);
  };
  const skillsLine = () => {
    const reqs = facts.matched.slice(0, 3);
    return reqs.length ? sentence(`Day to day I've been working in ${list2(reqs)}, which is most of what ${thisRole(job.title)} asks for`) : "";
  };

  switch (kind) {
    case "salary": {
      const s = profile.salaryExpectation;
      if (!s?.amount) return done("I'm flexible here and happy to talk numbers once I know more about the role.");
      return done(`${formatMoney(s)}, open to talking about it.`);
    }
    case "availability": {
      const parts: string[] = [];
      if (profile.earliestStartDate) parts.push(`I could start on ${formatDate(profile.earliestStartDate)}.`);
      if (profile.noticePeriodWeeks !== undefined) {
        const w = profile.noticePeriodWeeks;
        parts.push(w === 0 ? (parts.length ? "I don't have a notice period to work through." : "I can start right away, no notice period.")
          : `${parts.length ? "I'd" : "I'd just"} need to give ${w} week${w === 1 ? "" : "s"}' notice${parts.length ? " first" : ", so I could start shortly after that"}.`);
      }
      return done(parts.length ? parts.join(" ") : "I'm flexible on timing and happy to work around what suits the team.");
    }
    case "relocation": {
      const loc = profile.location ? ` I'm based in ${profile.location} right now.` : "";
      if (profile.willingToRelocate === true) return done(`Yes, I'm open to relocating for this.${loc}`);
      if (profile.willingToRelocate === false) return done(`I'd rather not relocate at the moment.${loc ? `${loc.replace(/\.$/, "")}, and I'm happy to talk about remote or hybrid setups.` : " Happy to talk about remote or hybrid setups."}`);
      return done(`I'm open to talking about it.${loc}`);
    }
    case "referral_source":
      return done("Job board");
    case "portfolio_link": {
      const site = profile.website ?? input.baseline.contact.website ?? profile.github;
      return done(site ?? null);
    }
    case "anything_else": {
      if (!field.required) return done("");
      const topic = story?.project ?? (story ? "metrics" : undefined);
      if (story) sources.add(story.nodeId);
      return done(`Nothing big to add. My resume has the details, and I'm happy to go deeper on ${topic === "metrics" ? `the ${story!.company ?? "recent"} work` : topic ? `the ${lcFirst(topic)}` : "any of it"} if that's useful.`);
    }
    case "motivation_company":
    case "motivation_role":
    case "cover_letter": {
      const req = overlapReq(input, facts);
      const ev = req ? evidenceForReq(facts, input, req) : undefined;
      if (ev) sources.add(ev.nodeId);
      const where = ev?.companyLabel ?? story?.company;
      const atW = where ? ` at ${where}` : "";
      const line = req ? productLine(job, req) : null;
      const overlapVariants = !req ? [] : line ? [
        `${line}, and it's what I've been building with${atW}`,
        `${line}, and I've been using it myself${atW}`,
        `${line}, which matters to me since it's what I've been working in${atW}`,
        `${line}, and it's been part of my stack${atW}`,
      ] : [
        `You're asking for ${req}, and that's what I've been using${atW}`,
        `${ucFirst(req)} is all over the posting, and it's what I've worked in${atW}`,
        `The ${req} side of this lines up with what I've been doing${atW}`,
        `I've been working with ${req}${atW}, so a lot of this post felt familiar`,
      ];
      if (line) sources.add("job:description");
      const metric = metricLine(story, kind === "motivation_role" ? undefined : where);
      const closers = [
        `Doing more of that as a ${job.title} at ${company} sounds like a really good next step for me.`,
        `I'd like my next ${roleNoun(job.title)} to be that kind of work, and ${company} is where I'd want to do it.`,
        `That's the kind of problem I want to keep working on, and ${thisRole(job.title)} at ${company} is a good fit for it.`,
        `I'd love to bring that to ${company} and keep learning from people who do it every day.`,
      ];
      const lead = kind === "motivation_role"
        ? (facts.matched.length ? sentence(`${ucFirst(thisRole(job.title))} is pretty close to what I already do: ${list2(facts.matched.slice(0, 2))}`) : "")
        : "";
      for (const hook of companyHooks(input, facts)) {
        const hookS = sentence(hook.text);
        const core = kind === "motivation_role"
          ? [lead, metric, hook.generic && lead ? "" : hookS]
          : [hookS, req ? sentence(pick(overlapVariants)) : "", metric];
        const answer = fit(core, closers[v], [secondLine, extraProject, skillsLine], mode);
        if (!lint(answer, mode).some((i) => !/^too (short|long)/.test(i))) {
          sources.add(hook.source);
          return done(answer);
        }
      }
      return done(fit([req ? sentence(pick(overlapVariants)) : "", metric], closers[v], [secondLine, extraProject, skillsLine], mode));
    }
    case "project_story":
    case "challenge_story": {
      if (!useStory(story)) return unknownAnswer(input, facts, sources, mode, [extraProject, skillsLine]);
      const s = storySentences(story!, facts, v);
      // One story told fully: context, what I did, the outcome, what it taught me, why it matters for this job.
      const subject = storySubject(story!);
      const intros = kind === "project_story"
        ? [`The one I'd pick is ${subject}.`, `Easy answer for me: ${subject}.`, `I keep coming back to ${subject}.`, `My favorite is probably ${subject}.`]
        : [`The hardest one I've had was ${subject}.`, `A good example is ${subject}.`, `The one that tested me most was ${subject}.`, `I'd point to ${subject}.`];
      const reqs = facts.matched.filter((m) => m.length <= 25).slice(0, 2);
      const reflect = kind === "project_story"
        ? [
          "I liked it because the result was easy to measure and easy to explain.",
          "It's still the project I bring up first when someone asks what I like building.",
          "What I liked most was having a clear number to aim at.",
          "I liked that the work was concrete and easy to check.",
        ]
        : [
          "The main thing I took from it was to measure first and fix second.",
          "What I learned is to get a number on the problem before arguing about solutions.",
          "It taught me to break a big, vague problem into pieces I could actually check.",
          "I'd handle it the same way again: measure it, fix the biggest piece, measure again.",
        ];
      const whyHere = reqs.length ? [
        `It's a lot like what ${thisRole(job.title)} asks for, especially the ${list2(reqs)} parts.`,
        `That's also why the ${reqs[0]} part of the ${company} post caught my eye.`,
        `I'd bring the same approach to ${thisRole(job.title)} at ${company}, where ${list2(reqs)} come up a lot.`,
        `It lines up with ${thisRole(job.title)} at ${company}, since ${list2(reqs)} are a big part of it.`,
      ] : [`It's the kind of work I'd want to keep doing at ${company}.`];
      return done(fit([intros[v], s.problem, s.did, s.outcome, reflect[v]], whyHere[v % whyHere.length], [skillsLine], mode));
    }
    case "strengths": {
      const [a, b] = facts.matched;
      if (!a) return unknownAnswer(input, facts, sources, mode, [extraProject, skillsLine]);
      const proof = facts.stories.find((s) => s.reqs.has(a)) ?? story;
      useStory(proof);
      const opener = b ? pick([`I'd say ${a} and ${b}.`, `Probably ${a}, and ${b} close behind.`, `${ucFirst(a)} and ${b}, if I had to pick two.`, `The two I'd name are ${a} and ${b}.`]) : `I'd say ${a}.`;
      const proofLine = proof ? sentence(`On ${a}, the clearest proof is from ${proof.company ?? "my last role"}, where ${iDid(proof.statement) ?? `the result was that ${lcFirst(proof.statement)}`}`) : "";
      const bLine = b ? sentence(`${ucFirst(b)} came up constantly there too${proof?.project ? `, especially on the ${lcFirst(proof.project)}` : ""}`) : "";
      return done(fit([opener, proofLine, bLine], sentence(`Both are a big part of ${thisRole(job.title)}, which is a lot of why I applied`), [secondLine, extraProject], mode));
    }
    case "weaknesses": {
      const gap = facts.missing[0];
      const [a, b] = facts.matched;
      const proof = useStory(story);
      const did = proof ? iDid(proof.statement) ?? `the result was that ${lcFirst(proof.statement)}` : "";
      const deep = list2([a, b].filter(Boolean) as string[]) || "one part of the stack";
      const core = gap
        ? [sentence(pick([
            `Honest answer: ${gap} is where I have the least hands-on time so far, and I'd rather say that up front`,
            `The obvious one for this ${roleNoun(job.title)} is ${gap}, since I haven't used it much yet`,
            `I haven't spent much real time with ${gap}, and I know it matters here`,
            `My weak spot for this ${roleNoun(job.title)} is ${gap}, which I've barely touched so far`,
          ])),
          proof ? sentence(`What I can point to is ${a ?? "the work"} at ${proof.company ?? "my last job"}, where ${did}`) : "",
          sentence(`I'd close the ${gap} gap the same way, by using it on real work as early as I can`)]
        : [sentence(pick([
            `My experience is pretty concentrated in ${deep}, so the rest of the stack is where I have the most to learn`,
            `I've gone deep on ${deep} and less wide, so newer tools take me a bit of ramp-up`,
            `Most of my time has been in ${deep}, which means I'm less practiced outside of that`,
            `I'd say breadth. I know ${deep} well, but I've spent less time on the rest of the stack`,
          ])),
          proof ? sentence(`The depth has paid off, like at ${proof.company ?? "my last job"}, where ${did}`) : "",
          sentence(`I'm working on it by picking up the pieces I haven't touched as early as I can`)];
      return done(fit(core, null, ["I'd rather be upfront about that than oversell myself.", secondLine], mode));
    }
    case "why_leaving": {
      const cur = facts.current;
      const reqs = facts.matched.slice(0, 2);
      const proof = useStory(facts.stories.find((s) => s.company === cur?.company) ?? story);
      const since = cur?.start ? ` since ${cur.start}` : "";
      const did = proof ? iDid(proof.statement) : null;
      const core = [
        sentence(cur ? pick([
          `I've had a good run at ${cur.company}${since}`,
          `I'm not running from anything. I've liked my time at ${cur.company}${since}`,
          `It's mostly about what's next. I've been at ${cur.company}${since} and learned a lot`,
          `${cur.company} has been good to me${since}`,
        ]) : "I've learned a lot where I am"),
        proof ? sentence(did ? `${did}, and I'm proud of that` : `The highlight was that ${lcFirst(proof.statement)}`) : "",
        sentence(pick([
          `I want my next step to be closer to ${list2(reqs) || "the product side"}, and ${thisRole(job.title)} at ${company} is pretty much that`,
          `Now I want to spend more of my time on ${list2(reqs) || "product work"}, which is what ${thisRole(job.title)} at ${company} is about`,
          `What I'm after next is more ${list2(reqs) || "hands-on product work"}, and that's a big part of ${thisRole(job.title)} at ${company}`,
        ])),
      ];
      return done(fit(core, null, [extraProject, secondLine], mode));
    }
    case "team_fit": {
      const proof = useStory(story);
      const core = [
        sentence(pick(["I like working closely with people and keeping things simple", "I work best when the team talks often and keeps things simple", "I like small, direct teams where people say what they think", "I'm happiest on teams that share work early and often"])),
        proof ? sentence(`At ${proof.company ?? "my last job"}, ${iDid(proof.statement) ?? `the result was that ${lcFirst(proof.statement)}`}, and work like that goes a lot better when people share what they're seeing early`) : "",
        sentence("I'm comfortable owning a piece end to end and asking for help when I'm stuck"),
      ];
      return done(fit(core, null, [extraProject, skillsLine], mode));
    }
    default:
      return unknownAnswer(input, facts, sources, mode, [extraProject, skillsLine]);
  }
}

/** Unknown questions: answer from evidence that shares words with the question; otherwise leave it to the user. */
function unknownAnswer(input: ComposeInput, facts: Facts, sources: Set<string>, mode: LintMode, more: Array<() => string> = []): { answer: string | null; sources: string[] } {
  const rel = facts.relevant;
  if (!rel.length) return { answer: input.field.required ? null : "", sources: [] };
  const metric = rel.find((e) => e.nodeType === "metric") ?? facts.stories.find((s) => rel.some((e) => e.roleId && e.roleId === s.roleId));
  const owner = rel.find((e) => e.nodeType === "role" || e.nodeType === "project");
  const parts: string[] = [];
  if (owner) {
    sources.add(owner.nodeId);
    parts.push(sentence(`I've done this at ${owner.companyLabel ?? owner.label}${owner.requirement ? `, mostly around ${owner.requirement}` : ""}`));
  }
  if (metric) {
    const st = "statement" in metric ? metric.statement : metric.text;
    sources.add(metric.nodeId);
    const d = iDid(st);
    parts.push(sentence(d ?? `One result: ${lcFirst(st)}`));
  }
  if (!parts.length) {
    const e = rel[0];
    sources.add(e.nodeId);
    parts.push(sentence(e.nodeType === "skill" || e.nodeType === "tool" ? `Yes, ${e.label} is something I've worked with` : `The closest thing I have is ${lcFirst(e.text)}`));
  }
  const extra = facts.stories.filter((s) => !sources.has(s.nodeId)).slice(0, 2).map((s, i) => () => {
    sources.add(s.nodeId);
    const d = iDid(s.statement);
    return sentence(d ? `${i === 0 ? "I also" : "And separately, I"} ${d.slice(2)}` : `Another result: ${lcFirst(s.statement)}`);
  });
  return { answer: fit(parts, null, [...extra, ...more], mode), sources: [...sources] };
}

const aOrAn = (s: string) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;


function formatMoney(s: SalaryExpectation): string {
  const cur = (s.currency ?? "USD").toUpperCase();
  const sym = cur === "USD" || cur === "CAD" || cur === "AUD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "";
  const amt = s.amount >= 1000 && s.amount % 1000 === 0 ? `${s.amount / 1000}k`
    : s.amount >= 1000 ? `${Math.round(s.amount / 100) / 10}k` : String(s.amount);
  const money = sym ? `${sym}${amt}` : `${amt} ${cur}`;
  const per = s.period === "hour" ? " an hour" : s.period === "month" ? " a month" : " a year";
  return `Around ${money}${per}`;
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return iso;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m[2]) - 1];
  return m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`;
}
