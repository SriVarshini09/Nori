import { z } from "zod";
import { getLLM, withFallback } from "../llm/index.js";
import type { Evidence, TailorInput, TailorResult } from "../contracts.js";
import type { ResumeBullet, ResumeChange, ResumeContent } from "../db/schema.js";
import { joinList, mentionsSkill, norm, numbersIn, sameSkill, wordCount } from "../match/text.js";
import { startsWithVerb, strengthenOpener } from "./verbs.js";

export type TailorOutcome = TailorResult & { rejected: { bulletId: string; reason: string }[] };

/** Max bullets one skill may be appended to, so the resume reads naturally instead of keyword-stuffed. */
const MAX_APPENDS_PER_SKILL = 2;
const MAX_BULLET_WORDS = 28;

// ---------------------------------------------------------------- shared context

type Section = { key: string; bullets: ResumeBullet[] };
type Ctx = {
  input: TailorInput;
  required: string[];
  nice: string[];
  /** Optional skills from requirements.skills only (safe to append in parentheses). */
  niceSkills: string[];
  keywords: string[];
  /** Every skill-like term we know: requirement skills, keywords, baseline skills. Used for the fabrication check. */
  vocab: string[];
  byNode: Map<string, Evidence[]>;
  baselineText: string;
  allEvidenceText: string;
};

function buildCtx(input: TailorInput): Ctx {
  const req = input.requirements;
  const required = uniq(req.skills.filter((s) => s.required).map((s) => s.name));
  const nice = uniq([...req.skills.filter((s) => !s.required).map((s) => s.name), ...req.niceToHaves.filter((n) => wordCount(n) <= 3)])
    .filter((n) => !required.some((r) => sameSkill(r, n)));
  const keywords = uniq(req.keywords);
  const vocab = uniq([...required, ...nice, ...keywords, ...input.baseline.skills.flatMap((g) => g.items)]);
  const byNode = new Map<string, Evidence[]>();
  for (const e of input.evidence) {
    const list = byNode.get(e.nodeId) ?? [];
    list.push(e);
    byNode.set(e.nodeId, list);
  }
  const niceSkills = nice.filter((n) => req.skills.some((s) => !s.required && sameSkill(s.name, n)));
  return {
    input, required, nice, niceSkills, keywords, vocab, byNode,
    baselineText: contentText(input.baseline),
    allEvidenceText: input.evidence.map((e) => `${e.label}. ${e.text}`).join("\n"),
  };
}

function sectionsOf(c: ResumeContent): Section[] {
  return [
    ...c.experience.map((r, i) => ({ key: `exp:${i}`, bullets: r.bullets })),
    ...(c.projects ?? []).map((p, i) => ({ key: `proj:${i}`, bullets: p.bullets })),
  ];
}

/** Evidence text a bullet may draw from: its own text plus every evidence row on its nodes. */
export function bulletSupport(bullet: ResumeBullet, evidence: Evidence[] | Map<string, Evidence[]>): string {
  const byNode = evidence instanceof Map ? evidence : groupByNode(evidence);
  const parts = [bullet.text];
  for (const id of bullet.nodeIds) for (const e of byNode.get(id) ?? []) parts.push(e.label, e.text);
  return parts.join("\n");
}

function groupByNode(evidence: Evidence[]): Map<string, Evidence[]> {
  const m = new Map<string, Evidence[]>();
  for (const e of evidence) m.set(e.nodeId, [...(m.get(e.nodeId) ?? []), e]);
  return m;
}

// ---------------------------------------------------------------- validator

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Guard against fabrication in a rewritten bullet:
 *  - nodeIds must be a subset of the original bullet's nodeIds
 *  - every number must already appear in the original text or its evidence
 *  - no known skill/tool may appear unless the original text or evidence mentions it
 *  - must be non-empty, a sane length, and free of first-person pronouns
 */
export function validateBullet(original: ResumeBullet, candidate: { text: string; nodeIds: string[] }, supportText: string, vocab: string[] = []): Verdict {
  const text = (candidate.text ?? "").trim();
  if (!text) return { ok: false, reason: "empty text" };
  const allowed = new Set(original.nodeIds);
  const extra = (candidate.nodeIds ?? []).filter((id) => !allowed.has(id));
  if (extra.length > 0) return { ok: false, reason: `unknown nodeIds ${extra.join(", ")}` };
  const known = new Set(numbersIn(`${original.text}\n${supportText}`));
  const newNums = numbersIn(text).filter((n) => !known.has(n));
  if (newNums.length > 0) return { ok: false, reason: `introduces number(s) ${newNums.join(", ")} not in evidence` };
  const support = `${original.text}\n${supportText}`;
  const newSkills = vocab.filter((v) => mentionsSkill(text, v) && !mentionsSkill(support, v));
  if (newSkills.length > 0) return { ok: false, reason: `mentions ${newSkills.join(", ")} without evidence` };
  if (/\b(I|me|my|mine|we|our|us)\b/.test(text.replace(/\bU\.?S\.?\b/g, ""))) return { ok: false, reason: "first-person pronoun" };
  const wc = wordCount(text);
  if (wc < 6 || wc > 34) return { ok: false, reason: `length ${wc} words` };
  return { ok: true };
}

function validateSummary(summary: string, ctx: Ctx): Verdict {
  const s = (summary ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const support = `${ctx.baselineText}\n${ctx.allEvidenceText}`;
  const known = new Set(numbersIn(support));
  const nums = numbersIn(s).filter((n) => !known.has(n));
  if (nums.length) return { ok: false, reason: `numbers ${nums.join(", ")}` };
  const skills = ctx.vocab.filter((v) => mentionsSkill(s, v) && !mentionsSkill(support, v));
  if (skills.length) return { ok: false, reason: `unsupported ${skills.join(", ")}` };
  if (/\b(I|me|my|we|our)\b/.test(s)) return { ok: false, reason: "first person" };
  if (wordCount(s) > 60) return { ok: false, reason: "too long" };
  return { ok: true };
}

// ---------------------------------------------------------------- heuristic pieces

type BulletEdit = { text: string; reason?: string };

function heuristicBullet(b: ResumeBullet, ctx: Ctx, usage: Map<string, number>): BulletEdit {
  let text = strengthenOpener(b.text);
  const reasons: string[] = [];
  if (text !== b.text) reasons.push("Replaced a weak opener with the action verb it described");

  const ev = b.nodeIds.flatMap((id) => ctx.byNode.get(id) ?? []);
  const supported = (s: string) => ev.some((e) => mentionsSkill(e.label, s) || mentionsSkill(e.text, s));
  const toAdd: string[] = [];
  for (const s of [...ctx.required, ...ctx.niceSkills]) {
    if (toAdd.length >= 2) break;
    if (mentionsSkill(text, s) || !supported(s)) continue;
    if ((usage.get(norm(s)) ?? 0) >= MAX_APPENDS_PER_SKILL) continue;
    toAdd.push(s);
  }
  while (toAdd.length > 0 && wordCount(text) + toAdd.length > MAX_BULLET_WORDS) toAdd.pop();
  if (toAdd.length > 0) {
    const m = /([.;])\s*$/.exec(text);
    const core = m ? text.slice(0, m.index) : text;
    text = `${core} (${toAdd.join(", ")})${m ? m[1] : ""}`;
    for (const s of toAdd) usage.set(norm(s), (usage.get(norm(s)) ?? 0) + 1);
    const reqd = toAdd.filter((s) => ctx.required.includes(s));
    reasons.push(`Surfaced ${joinList(toAdd)} from the linked evidence${reqd.length ? " to match required skills" : " to match nice-to-haves"}`);
  }
  return { text, reason: reasons.length ? reasons.join("; ") : undefined };
}

function relevance(text: string, ctx: Ctx): number {
  let n = 0;
  for (const s of ctx.required) if (mentionsSkill(text, s)) n += 2;
  for (const s of ctx.nice) if (mentionsSkill(text, s)) n += 1;
  for (const k of ctx.keywords) if (!ctx.required.includes(k) && !ctx.nice.includes(k) && mentionsSkill(text, k)) n += 1;
  return n;
}

function sortByRelevance(bullets: ResumeBullet[], ctx: Ctx): ResumeBullet[] {
  return bullets.map((b, i) => ({ b, i, r: relevance(b.text, ctx) }))
    .sort((x, y) => y.r - x.r || x.i - y.i)
    .map((x) => x.b);
}

/** Skills: required first, then nice-to-have, then keywords, then the rest; adds graph-backed required skills that were missing. */
function tailorSkills(baseline: ResumeContent["skills"], ctx: Ctx, preferredOrder: string[] = []): { skills: ResumeContent["skills"]; added: string[] } {
  const groups = baseline.map((g) => ({ group: g.group, items: [...g.items] }));
  const has = (s: string) => groups.some((g) => g.items.some((i) => sameSkill(i, s)));
  const added: string[] = [];
  for (const s of ctx.required) {
    if (has(s)) continue;
    const ev = ctx.input.evidence.find((e) => sameSkill(e.label, s) || ((e.nodeType === "skill" || e.nodeType === "tool") && mentionsSkill(e.label, s)) || mentionsSkill(e.text, s));
    if (!ev) continue;
    if (groups.length === 0) groups.push({ group: "Skills", items: [] });
    const target = groups.find((g) => /framework|librar|tool|technolog|platform|other/i.test(g.group)) ?? groups[0];
    target.items.push(s);
    added.push(s);
  }
  const tier = (item: string) => {
    const r = ctx.required.findIndex((s) => sameSkill(s, item));
    if (r >= 0) return r;
    const n = ctx.nice.findIndex((s) => sameSkill(s, item));
    if (n >= 0) return 100 + n;
    const k = ctx.keywords.findIndex((s) => sameSkill(s, item));
    if (k >= 0) return 200 + k;
    return 1000;
  };
  const pref = (item: string) => {
    const i = preferredOrder.findIndex((p) => sameSkill(p, item));
    return i < 0 ? 9999 : i;
  };
  const sorted = groups.map((g, gi) => ({
    gi,
    group: g.group,
    items: g.items.map((it, i) => ({ it, i })).sort((a, b) => tier(a.it) - tier(b.it) || pref(a.it) - pref(b.it) || a.i - b.i).map((x) => x.it),
  }));
  const reqCount = (items: string[]) => items.filter((i) => tier(i) < 100).length;
  sorted.sort((a, b) => reqCount(b.items) - reqCount(a.items) || a.gi - b.gi);
  return { skills: sorted.map(({ group, items }) => ({ group, items })), added };
}

/** Whole years from the earliest role start (YYYY or YYYY-MM...) to `now`; null when no parsable start. */
export function yearsOfExperience(roles: ResumeContent["experience"], now: Date = new Date()): number | null {
  let earliest: number | null = null;
  for (const r of roles) {
    const m = /^(\d{4})(?:-(\d{1,2}))?/.exec((r.start ?? "").trim());
    if (!m) continue;
    const t = Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
    if (earliest === null || t < earliest) earliest = t;
  }
  if (earliest === null) return null;
  const years = Math.floor((now.getFullYear() * 12 + now.getMonth() - earliest) / 12);
  return years >= 1 && years < 60 ? years : null;
}

/** Distinct terms by canonical skill name, case-insensitive, first spelling wins. */
function distinctTerms(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const t = (x ?? "").trim();
    if (t && !out.some((o) => sameSkill(o, t))) out.push(t);
  }
  return out;
}

function heuristicSummary(content: ResumeContent, ctx: Ctx, now: Date = new Date()): string {
  const roles = content.experience;
  // The most recent title opens the summary once; the job title is only a fallback, never repeated.
  const title = roles[0]?.title?.trim() || ctx.input.jobTitle?.trim() || "Professional";
  const flat = content.skills.flatMap((g) => g.items);
  const allText = contentText(content);
  const top = distinctTerms([...ctx.required, ...ctx.niceSkills, ...flat])
    .filter((s) => flat.some((f) => sameSkill(f, s)) || mentionsSkill(allText, s))
    .slice(0, 4);
  const years = yearsOfExperience(roles, now);
  const lead = years ? `${title} with ${years} year${years === 1 ? "" : "s"} of hands-on experience` : `${title} with hands-on experience`;
  const line1 = top.length > 0 ? `${lead} in ${joinList(top)}.` : `${lead} shipping production work.`;
  let line2 = "";
  if (roles.length >= 2) {
    const companies = distinctTerms(roles.map((r) => r.company).filter(Boolean));
    line2 = companies.length >= 2 ? `Experience spans ${roles.length} roles at ${joinList(companies.slice(0, 3))}` : `Most recently at ${companies[0] ?? roles[0].company}`;
  } else if (roles[0]?.company) line2 = `Most recently at ${roles[0].company}`;
  if (line2) {
    const recent = (roles[0]?.bullets ?? []).map((b) => b.text).join(" ");
    const focus = distinctTerms([...ctx.required, ...ctx.keywords])
      .filter((k) => !top.some((t) => sameSkill(t, k)) && !sameSkill(k, title) && mentionsSkill(recent, k))
      .slice(0, 3);
    line2 += focus.length >= 2 ? `, with recent work in ${joinList(focus)}.` : ".";
  }
  return [line1, line2].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- drafts

type Draft = {
  content: ResumeContent;
  reasons: Map<string, string>;
  rejected: { bulletId: string; reason: string }[];
  skillsAdded: string[];
};

function heuristicDraft(ctx: Ctx): Draft {
  const base = structuredClone(ctx.input.baseline);
  const reasons = new Map<string, string>();
  const usage = new Map<string, number>();
  for (const sec of sectionsOf(base)) {
    for (const b of sec.bullets) {
      const edit = heuristicBullet(b, ctx, usage);
      if (edit.text !== b.text) { b.text = edit.text; if (edit.reason) reasons.set(b.id, edit.reason); }
    }
  }
  base.experience = base.experience.map((r) => ({ ...r, bullets: sortByRelevance(r.bullets, ctx) }));
  if (base.projects) base.projects = base.projects.map((p) => ({ ...p, bullets: sortByRelevance(p.bullets, ctx) }));
  const { skills, added } = tailorSkills(base.skills, ctx);
  base.skills = skills;
  base.summary = heuristicSummary(base, ctx);
  return { content: base, reasons, rejected: [], skillsAdded: added };
}

const LlmSchema = z.object({
  experience: z.array(z.object({
    bullets: z.array(z.object({ id: z.string(), text: z.string(), nodeIds: z.array(z.string()) })),
  })),
  summary: z.string(),
  skillsOrder: z.array(z.string()),
});
type LlmOut = z.infer<typeof LlmSchema>;

export const TAILOR_SYSTEM = `You tailor resume bullets to a specific job. You are editing a real person's resume, so accuracy beats persuasion.

Hard rules:
1. Never invent facts, numbers, percentages, dollar amounts, team sizes, employers, titles, dates, tools or technologies.
2. Use only the original bullet and the evidence listed under it. If the evidence does not support a job keyword, leave it out.
3. Keep each bullet 12 to 24 words, one sentence, no trailing period required.
4. Start every bullet with a strong past-tense action verb (Built, Led, Reduced, Shipped). No "Responsible for", no "Helped".
5. Work in the job's required keywords only where the evidence genuinely supports them, using the job's exact spelling.
6. Preserve the original meaning and scope. Do not upgrade "contributed to" into "led".
7. Return every bullet of every role, in role order, with its id and nodeIds exactly as given. You may reorder bullets within a role, most relevant first.
8. No first-person pronouns. No buzzword filler ("synergy", "results-driven").
9. summary: two lines (25 to 45 words) built from the most recent title and the strongest supported skills. No invented claims.
10. skillsOrder: the candidate's existing skills, most relevant to this job first. Do not add skills that are not in the list.`;

/**
 * The tailoring prompt at one of three sizes, for models with small context windows (Ollama ships with 4096 tokens):
 *   0 full evidence (up to 8 lines per bullet), indented
 *   1 at most 3 evidence lines per bullet, cut to 160 characters, compact JSON, no nice-to-haves
 *   2 bullets only, no evidence text
 * Shrinking never weakens the truthfulness check: the model's output is validated against the full evidence
 * locally (validateBullet), whatever the prompt carried.
 */
export function buildPrompt(ctx: Ctx, level: 0 | 1 | 2 = 0): string {
  const { input } = ctx;
  const cut = (t: string) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);
  const evidenceOf = (nodeIds: string[]) => {
    if (level === 2) return undefined;
    const lines = nodeIds.flatMap((id) => (ctx.byNode.get(id) ?? []).map((e) => `${e.label}: ${e.text}`));
    return level === 0 ? lines.slice(0, 8) : lines.slice(0, 3).map(cut);
  };
  const roles = sectionsOf(input.baseline).map((sec, i) => {
    const role = sec.key.startsWith("exp:") ? input.baseline.experience[Number(sec.key.slice(4))] : undefined;
    const proj = sec.key.startsWith("proj:") ? input.baseline.projects?.[Number(sec.key.slice(5))] : undefined;
    return {
      index: i,
      heading: role ? `${role.title} at ${role.company}` : `Project: ${proj?.name ?? ""}`,
      bullets: sec.bullets.map((b) => ({ id: b.id, text: b.text, nodeIds: b.nodeIds, evidence: evidenceOf(b.nodeIds) })),
    };
  });
  const payload = {
    job: { title: input.jobTitle, company: input.companyName, summary: level === 0 ? input.requirements.summary : cut(input.requirements.summary ?? "") },
    requiredSkills: ctx.required,
    niceToHave: level === 0 ? ctx.nice : undefined,
    keywords: level === 0 ? ctx.keywords : ctx.keywords.slice(0, 12),
    mustHaves: level === 0 ? input.requirements.mustHaves : input.requirements.mustHaves?.slice(0, 5),
    candidateSkills: input.baseline.skills.flatMap((g) => g.items),
    roles,
    note: "Return experience[] with one entry per item in roles[], same order (projects included at the end).",
  };
  return level === 0 ? JSON.stringify(payload, null, 1) : JSON.stringify(payload);
}

/** The model could not take the prompt at this size (Ollama's window guard throws this); a smaller one may fit. */
const isWindowError = (e: unknown) => /would be cut off|context (length|window)|maximum context/i.test(e instanceof Error ? e.message : String(e));

async function llmDraft(ctx: Ctx): Promise<Draft> {
  let out: LlmOut | undefined;
  for (const level of [0, 1, 2] as const) {
    try {
      out = await getLLM().json({
        name: "tailored_resume", system: TAILOR_SYSTEM, prompt: buildPrompt(ctx, level), schema: LlmSchema, maxTokens: level === 0 ? 8000 : 4000, effort: "medium",
      });
      break;
    } catch (e) {
      if (level === 2 || !isWindowError(e)) throw e;
    }
  }
  if (!out) throw new Error("the model returned nothing");
  const base = structuredClone(ctx.input.baseline);
  const reasons = new Map<string, string>();
  const rejected: Draft["rejected"] = [];
  const usage = new Map<string, number>();
  const secs = sectionsOf(base);
  secs.forEach((sec, si) => {
    const got = out.experience[si]?.bullets ?? [];
    const byId = new Map(got.map((g) => [g.id, g]));
    for (const b of sec.bullets) {
      const cand = byId.get(b.id);
      const support = bulletSupport(b, ctx.byNode);
      let verdict: Verdict = cand ? validateBullet(b, cand, support, ctx.vocab) : { ok: false, reason: "missing from model output" };
      if (verdict.ok && cand && !startsWithVerb(cand.text)) verdict = { ok: false, reason: "does not start with an action verb" };
      if (verdict.ok && cand) {
        const t = cand.text.trim();
        if (t !== b.text) {
          const gained = [...ctx.required, ...ctx.keywords].filter((k) => mentionsSkill(t, k) && !mentionsSkill(b.text, k));
          reasons.set(b.id, gained.length ? `Reworded to surface ${joinList(uniq(gained).slice(0, 3))}, backed by linked evidence` : "Tightened wording and led with a stronger action verb");
          b.text = t;
        }
      } else {
        rejected.push({ bulletId: b.id, reason: verdict.ok ? "invalid" : verdict.reason });
        const edit = heuristicBullet(b, ctx, usage);
        if (edit.text !== b.text) { b.text = edit.text; if (edit.reason) reasons.set(b.id, edit.reason); }
      }
    }
    // keep model order when it returned exactly this role's ids, else keyword order
    const ids = got.map((g) => g.id);
    const same = ids.length === sec.bullets.length && sec.bullets.every((b) => ids.includes(b.id));
    const ordered = same ? ids.map((id) => sec.bullets.find((b) => b.id === id)!) : sortByRelevance(sec.bullets, ctx);
    sec.bullets.splice(0, sec.bullets.length, ...ordered);
  });
  const { skills, added } = tailorSkills(base.skills, ctx, out.skillsOrder);
  base.skills = skills;
  const sv = validateSummary(out.summary, ctx);
  base.summary = sv.ok ? out.summary.trim() : heuristicSummary(base, ctx);
  if (!sv.ok) rejected.push({ bulletId: "summary", reason: sv.reason });
  return { content: base, reasons, rejected, skillsAdded: added };
}

// ---------------------------------------------------------------- public

/** Tailor a baseline resume to a job. LLM when available, deterministic heuristic otherwise. Never fabricates. */
export async function tailorResume(input: TailorInput): Promise<TailorOutcome> {
  const ctx = buildCtx(input);
  const { value: draft, usedLLM } = await withFallback(() => llmDraft(ctx), () => heuristicDraft(ctx), "tailor.rewrite");
  return finalize(ctx, draft, usedLLM);
}

/** Offline path, exposed for tests and for callers that want determinism. */
export function tailorResumeHeuristic(input: TailorInput): TailorOutcome {
  const ctx = buildCtx(input);
  return finalize(ctx, heuristicDraft(ctx), false);
}

function finalize(ctx: Ctx, draft: Draft, usedLLM: boolean): TailorOutcome {
  const before = new Map<string, ResumeBullet>();
  for (const sec of sectionsOf(ctx.input.baseline)) for (const b of sec.bullets) before.set(b.id, b);

  const changes: ResumeChange[] = [];
  const provenance: Record<string, string[]> = {};
  for (const sec of sectionsOf(draft.content)) {
    for (const b of sec.bullets) {
      const orig = before.get(b.id);
      b.nodeIds = orig ? [...orig.nodeIds] : b.nodeIds; // nodeIds always come from the input
      provenance[b.id] = [...b.nodeIds];
      if (orig && orig.text !== b.text) {
        changes.push({ bulletId: b.id, before: orig.text, after: b.text, reason: draft.reasons.get(b.id) ?? "Reworded for this role", nodeIds: [...b.nodeIds] });
      }
    }
  }

  const baseSummary = ctx.input.baseline.summary ?? "";
  if ((draft.content.summary ?? "") !== baseSummary) {
    const summaryNodes = uniq(ctx.input.evidence.filter((e) => mentionsSkill(draft.content.summary ?? "", e.label)).map((e) => e.nodeId));
    changes.push({ bulletId: "summary", before: baseSummary, after: draft.content.summary ?? "", reason: `Rewritten for ${ctx.input.jobTitle} from the most recent title and strongest matching skills`, nodeIds: summaryNodes });
  }
  const skillsBefore = ctx.input.baseline.skills.map((g) => `${g.group}: ${g.items.join(", ")}`).join(" | ");
  const skillsAfter = draft.content.skills.map((g) => `${g.group}: ${g.items.join(", ")}`).join(" | ");
  if (skillsBefore !== skillsAfter) {
    const addedNodes = uniq(ctx.input.evidence.filter((e) => draft.skillsAdded.some((s) => sameSkill(s, e.label) || mentionsSkill(e.text, s))).map((e) => e.nodeId));
    changes.push({
      bulletId: "skills", before: skillsBefore, after: skillsAfter,
      reason: draft.skillsAdded.length ? `Added ${joinList(draft.skillsAdded)} (in your career graph) and moved required skills first` : "Moved required skills first",
      nodeIds: addedNodes,
    });
  }

  return {
    content: draft.content,
    changes,
    provenance,
    keywordCoverage: keywordCoverage(draft.content, ctx.input.requirements),
    usedLLM,
    rejected: draft.rejected,
  };
}

/** Share of requirement keywords (or skills, when no keywords) present anywhere in the resume text. */
export function keywordCoverage(content: ResumeContent, req: TailorInput["requirements"]): number {
  const terms = uniq(req.keywords.length ? req.keywords : req.skills.map((s) => s.name));
  if (terms.length === 0) return 1;
  const text = contentText(content);
  const hit = terms.filter((t) => mentionsSkill(text, t)).length;
  return Math.round((hit / terms.length) * 1000) / 1000;
}

/** Every visible string in the resume, newline-joined. */
export function contentText(c: ResumeContent): string {
  return [
    c.name, c.summary ?? "",
    ...c.experience.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...c.education.map((e) => [e.degree, e.field, e.school].filter(Boolean).join(" ")),
    ...c.skills.flatMap((g) => [g.group, g.items.join(", ")]),
    ...(c.projects ?? []).flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...(c.certifications ?? []),
  ].join("\n");
}

function uniq(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = (x ?? "").trim();
    if (!t || seen.has(norm(t))) continue;
    seen.add(norm(t));
    out.push(t);
  }
  return out;
}
