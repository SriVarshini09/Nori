import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { jobs, matches, profiles, type JobRequirements, type Preferences } from "../db/schema.js";
import type { Evidence, MatchResult } from "../contracts.js";
import { canon, containsTerm, joinList, mentionsSkill, norm, phraseCovered, sameSkill } from "./text.js";

export type MatchProfile = {
  preferences?: Preferences | null;
  location?: string | null;
  workAuth?: { authorizedUS?: boolean; needsSponsorship?: boolean; notes?: string } | Record<string, unknown> | null;
};

export type RetrieveEvidenceFn = (db: Db, userId: string, req: JobRequirements) => Promise<Evidence[]>;

export const MATCH_WEIGHTS = { required: 0.6, nice: 0.15, mustHaves: 0.15, keywords: 0.1 } as const;
export const DISQUALIFIER_PENALTY = 0.15;

/** Best evidence for a skill: labelled with it, mentioning it, or a skill node tagged for it. */
function findSkillEvidence(skill: string, evidence: Evidence[]): Evidence | null {
  let best: Evidence | null = null;
  let bestRank = -1;
  for (const e of evidence) {
    let rank = -1;
    if (sameSkill(e.label, skill)) rank = 3;
    else if (mentionsSkill(e.text, skill) || mentionsSkill(e.label, skill)) rank = 2;
    else if (sameSkill(e.requirement, skill) && (e.nodeType === "skill" || e.nodeType === "tool")) rank = 1;
    if (rank < 0) continue;
    const s = rank * 10 + (e.score ?? 0);
    if (s > bestRank) { bestRank = s; best = e; }
  }
  return best;
}

/** Evidence that fuzzily covers a phrase (must-have / nice-to-have sentence). */
function findPhraseEvidence(phrase: string, evidence: Evidence[]): Evidence | null {
  let best: Evidence | null = null;
  for (const e of evidence) {
    const body = `${e.label} ${e.text}`;
    const hit = phraseCovered(phrase, body) || mentionsSkill(body, phrase);
    if (hit && (!best || (e.score ?? 0) > (best.score ?? 0))) best = e;
  }
  return best;
}

const US_TERMS = /\b(us|u\.s\.?|usa|u\.s\.a\.?|united states|america)\b/i;
const US_STATE = /,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;

function locationSatisfies(required: string, places: string[]): boolean {
  const req = required.replace(/^the\s+/i, "").trim();
  if (!req || /\bremote\b/i.test(req)) return true;
  for (const p of places) {
    if (!p) continue;
    if (containsTerm(p, req) || containsTerm(req, p)) return true;
    if (US_TERMS.test(req) && (US_TERMS.test(p) || US_STATE.test(p))) return true;
    if (phraseCovered(req, p)) return true;
  }
  return false;
}

const NO_SPONSOR = /(no|not|unable to|cannot|can't|won't|will not)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor|without\s+(visa\s+)?sponsorship|sponsorship\s+(is\s+)?not\s+(available|offered|provided)/;
const MUST_AUTH = /(must|need to|required to)\s+be\s+(legally\s+)?(authorized|eligible)\s+to\s+work|u\.?s\.?\s+citizen|citizenship\s+(is\s+)?required|security clearance/;
const MUST_LOCATE = /(?:must|need to|required to)\s+(?:be\s+)?(?:located|based|reside|residing|live|living)\s+(?:in|within|near)\s+([^.;:()]+)/i;
const ONLY_OPEN = /only\s+(?:open|available)\s+to\s+(?:candidates|applicants)\s+(?:in|located in|based in)\s+([^.;:()]+)/i;

/** Disqualifiers that clash with what the profile says. Returns human-readable conflicts. */
export function disqualifierConflicts(disqualifiers: string[], profile: MatchProfile): string[] {
  const out: string[] = [];
  const wa = (profile.workAuth ?? {}) as { authorizedUS?: boolean; needsSponsorship?: boolean };
  const places = [profile.location ?? "", ...(profile.preferences?.locations ?? [])].filter(Boolean) as string[];
  for (const d of disqualifiers) {
    const t = d.toLowerCase();
    if (NO_SPONSOR.test(t) && wa.needsSponsorship === true) {
      out.push("Role offers no visa sponsorship and you need it");
      continue;
    }
    if (MUST_AUTH.test(t) && (wa.authorizedUS === false || (wa.needsSponsorship === true && /citizen|clearance/.test(t)))) {
      out.push("Role requires US work authorization you have not confirmed");
      continue;
    }
    const loc = MUST_LOCATE.exec(d) ?? ONLY_OPEN.exec(d);
    if (loc && places.length > 0) {
      const where = loc[1].replace(/\s+(?:and|or)\s+(?:be|have|must)\b.*/i, "").trim();
      if (!locationSatisfies(where, places)) { out.push(`Role must be located in ${where}`); continue; }
    }
    if (profile.preferences?.remote === "only" && /(on-?site|in[- ]office|in person|no remote|not remote|hybrid)/.test(t)) {
      out.push("Role is not remote and you only want remote");
    }
  }
  return out;
}

type Category = { weight: number; total: number; covered: number };

/** Weighted coverage score with explanation. Pure. */
export function scoreMatch(requirements: JobRequirements, evidence: Evidence[], profile: MatchProfile = {}): MatchResult {
  const matched: MatchResult["matched"] = [];
  const missing: MatchResult["missing"] = [];
  const seen = new Set<string>();
  const push = (requirement: string, ev: Evidence, required: boolean) => {
    const key = `${norm(requirement)}|${ev.nodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    matched.push({ requirement, nodeId: ev.nodeId, label: ev.label, required });
  };

  const requiredSkills = dedupe(requirements.skills.filter((s) => s.required).map((s) => s.name));
  const niceSkills = dedupe(requirements.skills.filter((s) => !s.required).map((s) => s.name))
    .filter((n) => !requiredSkills.some((r) => sameSkill(r, n)));
  const nicePhrases = dedupe(requirements.niceToHaves)
    .filter((p) => ![...requiredSkills, ...niceSkills].some((r) => sameSkill(r, p)));

  // required skills (60%)
  const reqCat: Category = { weight: MATCH_WEIGHTS.required, total: requiredSkills.length, covered: 0 };
  const reqHits: { skill: string; ev: Evidence }[] = [];
  const missingRequired: string[] = [];
  for (const s of requiredSkills) {
    const ev = findSkillEvidence(s, evidence);
    if (ev) { reqCat.covered++; reqHits.push({ skill: s, ev }); push(s, ev, true); }
    else { missingRequired.push(s); missing.push({ requirement: s, required: true }); }
  }

  // nice-to-have (15%): optional skills + niceToHaves phrases
  const niceCat: Category = { weight: MATCH_WEIGHTS.nice, total: niceSkills.length + nicePhrases.length, covered: 0 };
  const niceCovered: string[] = [];
  for (const s of niceSkills) {
    const ev = findSkillEvidence(s, evidence);
    if (ev) { niceCat.covered++; niceCovered.push(s); push(s, ev, false); }
    else missing.push({ requirement: s, required: false });
  }
  for (const p of nicePhrases) {
    const ev = findPhraseEvidence(p, evidence);
    if (ev) { niceCat.covered++; niceCovered.push(p); push(p, ev, false); }
    else missing.push({ requirement: p, required: false });
  }

  // must-haves (15%), fuzzy
  const mustHaves = dedupe(requirements.mustHaves);
  const mustCat: Category = { weight: MATCH_WEIGHTS.mustHaves, total: mustHaves.length, covered: 0 };
  const mustMissing: string[] = [];
  for (const m of mustHaves) {
    const ev = findPhraseEvidence(m, evidence);
    if (ev) { mustCat.covered++; push(m, ev, true); }
    else { mustMissing.push(m); missing.push({ requirement: m, required: true }); }
  }

  // keywords (10%)
  const keywords = dedupe(requirements.keywords);
  const kwCat: Category = { weight: MATCH_WEIGHTS.keywords, total: keywords.length, covered: 0 };
  const corpus = evidence.map((e) => `${e.label}. ${e.text}`).join("\n");
  for (const k of keywords) if (mentionsSkill(corpus, k) || phraseCovered(k, corpus)) kwCat.covered++;

  // Empty categories drop out and the remaining weights are renormalized.
  const cats = [reqCat, niceCat, mustCat, kwCat].filter((c) => c.total > 0);
  const wsum = cats.reduce((a, c) => a + c.weight, 0);
  let score = wsum > 0 ? cats.reduce((a, c) => a + c.weight * (c.covered / c.total), 0) / wsum : 0;

  const conflicts = disqualifierConflicts(requirements.disqualifiers ?? [], profile);
  score -= DISQUALIFIER_PENALTY * conflicts.length;
  score = Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;

  const reasons = buildReasons({ reqHits, requiredSkills, missingRequired, niceCovered, niceTotal: niceCat.total, mustCat, mustMissing, kwCat, conflicts });
  return { score, matched, missing, reasons };
}

function dedupe(xs: string[] | undefined): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const x of xs ?? []) {
    const t = (x ?? "").trim();
    if (!t) continue;
    const k = canon(t);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(t);
  }
  return out;
}

function buildReasons(a: {
  reqHits: { skill: string; ev: Evidence }[]; requiredSkills: string[]; missingRequired: string[];
  niceCovered: string[]; niceTotal: number; mustCat: Category; mustMissing: string[]; kwCat: Category; conflicts: string[];
}): string[] {
  const r: string[] = [];
  for (const c of a.conflicts.slice(0, 2)) r.push(`${c}.`);
  if (a.reqHits.length > 0) {
    const top = a.reqHits.slice(0, 3);
    const roles = new Set(a.reqHits.map((h) => h.ev.roleId ?? h.ev.roleLabel).filter(Boolean));
    const via = roles.size > 0 ? ` via ${roles.size} role${roles.size === 1 ? "" : "s"}` : "";
    r.push(`Strong on ${joinList(top.map((h) => h.skill))}${via}.`);
  }
  if (a.missingRequired.length > 0) {
    const shown = a.missingRequired.slice(0, 3);
    const more = a.missingRequired.length - shown.length;
    r.push(`Missing ${joinList(shown)}${more > 0 ? ` and ${more} more` : ""} (required).`);
  }
  if (a.requiredSkills.length > 0) r.push(`Covers ${a.reqHits.length} of ${a.requiredSkills.length} required skills.`);
  if (a.mustCat.total > 0) {
    r.push(a.mustMissing.length === 0
      ? `Meets all ${a.mustCat.total} must-have${a.mustCat.total === 1 ? "" : "s"}.`
      : `Meets ${a.mustCat.covered} of ${a.mustCat.total} must-haves; unclear on "${truncate(a.mustMissing[0], 60)}".`);
  }
  if (a.niceCovered.length > 0) r.push(`Bonus: ${joinList(a.niceCovered.slice(0, 3).map((s) => truncate(s, 40)))}.`);
  else if (a.niceTotal > 0) r.push("No nice-to-haves covered yet.");
  if (a.kwCat.total > 0) r.push(`Evidence mentions ${a.kwCat.covered} of ${a.kwCat.total} job keywords.`);
  if (r.length < 3) r.push("Little structured requirement data, so this score is approximate.");
  if (r.length < 3) r.push("Add more career facts to sharpen this match.");
  return r.slice(0, 5);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`;
}

/** Load job requirements + evidence, score, and upsert the matches row. */
export async function computeMatch(db: Db, userId: string, jobId: string, retrieveEvidence: RetrieveEvidenceFn): Promise<MatchResult> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (!job.requirements) throw new Error(`Job ${jobId} has no extracted requirements`);
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const evidence = await retrieveEvidence(db, userId, job.requirements);
  const result = scoreMatch(job.requirements, evidence, {
    preferences: profile?.preferences ?? null,
    location: profile?.location ?? null,
    workAuth: profile?.workAuth ?? null,
  });
  const explanation = { matched: result.matched, missing: result.missing, reasons: result.reasons };
  await db.insert(matches)
    .values({ userId, jobId, score: result.score, explanation })
    .onConflictDoUpdate({ target: [matches.userId, matches.jobId], set: { score: result.score, explanation, computedAt: new Date() } });
  return result;
}

/** Read a stored match row, or null. */
export async function getMatch(db: Db, userId: string, jobId: string) {
  const [row] = await db.select().from(matches).where(and(eq(matches.userId, userId), eq(matches.jobId, jobId))).limit(1);
  return row ?? null;
}
