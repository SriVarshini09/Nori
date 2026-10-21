import type { JobRequirements, ResumeContent } from "../db/schema.js";
import { mentionsSkill, numbersIn, wordCount } from "../match/text.js";
import { yearsOfExperience } from "./rewrite.js";
import { FLUFF_RE } from "./fluff.js";
import { startsWithVerb } from "./verbs.js";

export { FLUFF_RE } from "./fluff.js";

/**
 * A recruiter's read of a resume against one job, as a deterministic checklist (no model, no network).
 *
 * It follows how screening really goes: first the filters (are the must-haves here, is the seniority and experience in
 * range), then the ten-second scan (title, summary, impact, clarity), then the credibility pass (gaps, stuffing, padding).
 * Nori uses it two ways: to show the person what a recruiter would see, and to measure whether a tailoring made the
 * resume better or only different. It never invents anything: it reports what the resume shows.
 */
export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewFinding = { id: string; severity: ReviewSeverity; title: string; detail: string; fix?: string };
export type SkillStatus = "demonstrated" | "listed" | "missing";
export type MustHave = { skill: string; required: boolean; status: SkillStatus };
export type RecruiterReview = {
  /** 0 to 100. */
  score: number;
  verdict: "strong" | "good" | "needs_work";
  strengths: string[];
  concerns: ReviewFinding[];
  /** Each skill the posting asks for, and whether the resume shows it in use, only lists it, or lacks it. */
  musts: MustHave[];
  stats: { bullets: number; quantifiedPct: number; strongVerbPct: number; avgBulletWords: number; years: number | null; requiredYears: number | null; skillsListed: number };
};

const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|manager)\b/i;
const JUNIOR_RE = /\b(intern|junior|jr\.?|trainee|apprentice|associate)\b/i;

const monthIndex = (s: string | undefined, fallbackNow: Date): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  if (/^(present|current|now|today)$/i.test(t)) return fallbackNow.getFullYear() * 12 + fallbackNow.getMonth();
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(t);
  return m ? Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0) : null;
};

export function recruiterReview(content: ResumeContent, req: JobRequirements | null, opts: { jobTitle?: string; pages?: number | null; now?: Date } = {}): RecruiterReview {
  const now = opts.now ?? new Date();
  const concerns: ReviewFinding[] = [];
  const strengths: string[] = [];
  const bulletsOf = [...content.experience.flatMap((r) => r.bullets), ...(content.projects ?? []).flatMap((p) => p.bullets)];
  const bulletText = bulletsOf.map((b) => b.text);
  const allSkills = content.skills.flatMap((g) => g.items);

  // ---- 1. the filters: must-haves, shown in use or only listed (35 points)
  const asked = req?.skills ?? [];
  const wanted = [...asked.filter((s) => s.required), ...asked.filter((s) => !s.required).slice(0, 6)];
  const musts: MustHave[] = wanted.map((s) => ({
    skill: s.name, required: s.required,
    status: bulletText.some((t) => mentionsSkill(t, s.name)) ? "demonstrated"
      : allSkills.some((k) => mentionsSkill(k, s.name)) || mentionsSkill(content.summary ?? "", s.name) ? "listed" : "missing",
  }));
  const required = musts.filter((m) => m.required);
  const value = (m: MustHave) => (m.status === "demonstrated" ? 1 : m.status === "listed" ? 0.5 : 0);
  const mustScore = required.length ? (required.reduce((n, m) => n + value(m), 0) / required.length) * 35 : 35;
  const missing = required.filter((m) => m.status === "missing");
  const listedOnly = required.filter((m) => m.status === "listed");
  if (required.length && !missing.length && !listedOnly.length) strengths.push(`Every required skill (${required.length}) is shown in use in your experience`);
  if (missing.length) {
    concerns.push({ id: "missing-must-have", severity: "high", title: `Missing ${missing.length} required skill${missing.length === 1 ? "" : "s"}: ${missing.map((m) => m.skill).join(", ")}`,
      detail: "Nothing on the resume shows these. Screeners and applicant systems filter on required skills.",
      fix: "Add them only if you really have the experience (tell Nori the fact so it is in your graph). Never list a skill you cannot discuss." });
  }
  if (listedOnly.length) {
    concerns.push({ id: "listed-only", severity: "medium", title: `${listedOnly.map((m) => m.skill).join(", ")} ${listedOnly.length === 1 ? "is" : "are"} only in the skills list`,
      detail: "A skill with no bullet that uses it reads as unproven.", fix: "Work it into the bullet where you used it, if that is true." });
  }

  // ---- 2. seniority and years (15 points)
  const years = yearsOfExperience(content.experience, now);
  const requiredYears = req?.yearsMin ?? null;
  let levelScore = 12;
  if (requiredYears && years !== null) {
    const ratio = years / requiredYears;
    levelScore = ratio >= 1 ? 15 : ratio >= 0.75 ? 9 : 3;
    if (ratio >= 1) strengths.push(`${years} years of experience meets the ${requiredYears}+ asked for`);
    else concerns.push({ id: "years", severity: ratio >= 0.75 ? "medium" : "high", title: `The role asks for ${requiredYears}+ years; the resume shows ${years}`,
      detail: "Years of experience is often a hard screen.", fix: "If you have more relevant experience (internships, freelance, projects), make sure it is dated and listed." });
  }
  // The other way round: an entry-level posting and a resume that reads ten years senior is a flight-risk signal.
  const entryRole = req?.seniority === "junior" || req?.seniority === "intern" || (!!requiredYears && requiredYears <= 2);
  if (entryRole && years !== null && requiredYears && years >= requiredYears * 3) {
    levelScore = Math.min(levelScore, 8);
    concerns.push({ id: "overqualified", severity: "medium", title: `The role is entry-level (${requiredYears}+ years) and the resume shows ${years}`,
      detail: "Recruiters worry an overqualified applicant will leave quickly or expect more pay.",
      fix: "Keep the facts, but lead with the skills the role uses and leave out years-of-experience claims in the summary." });
  }
  const latestTitle = content.experience[0]?.title ?? "";
  const jobTitle = opts.jobTitle ?? "";
  if ((SENIOR_RE.test(jobTitle) || req?.seniority === "senior" || req?.seniority === "staff" || req?.seniority === "lead") && JUNIOR_RE.test(latestTitle)) {
    levelScore = Math.min(levelScore, 5);
    concerns.push({ id: "seniority", severity: "high", title: `The role is senior but your latest title is "${latestTitle}"`,
      detail: "Recruiters compare your current level with the one being hired.", fix: "Check the title is accurate; if it understates your scope, say so in the first bullet." });
  }

  // ---- 3. impact, what leads, focus and clarity (30 points)
  const wc = bulletText.map(wordCount);
  const quantified = bulletText.filter((t) => numbersIn(t).length > 0).length;
  const quantifiedPct = bulletText.length ? Math.round((quantified / bulletText.length) * 100) : 0;
  const strongVerb = bulletText.filter(startsWithVerb).length;
  const strongVerbPct = bulletText.length ? Math.round((strongVerb / bulletText.length) * 100) : 0;
  const avgWords = wc.length ? Math.round((wc.reduce((a, b) => a + b, 0) / wc.length) * 10) / 10 : 0;
  const impactScore = quantifiedPct >= 50 ? 10 : quantifiedPct >= 30 ? 7 : quantifiedPct >= 15 ? 4 : 1;

  // What a recruiter reads first is the top of the most recent role, so the strongest match should be there.
  const relevantTo = (t: string) => asked.some((a) => mentionsSkill(t, a.name));
  const lead = (content.experience[0]?.bullets ?? []).slice(0, 2).map((b) => b.text);
  let leadScore = 5;
  if (asked.length && lead.length) {
    const resumeHasMatch = bulletText.some(relevantTo);
    if (resumeHasMatch && !lead.some(relevantTo)) {
      leadScore = 1;
      concerns.push({ id: "lead", severity: "medium", title: "The first bullets of your latest role do not mention what the job asks for",
        detail: "Recruiters read the top of the most recent role first.", fix: "Put the bullet that best matches the posting first." });
    } else if (lead.some(relevantTo)) strengths.push("The top of your latest role matches what the job asks for");
  }
  // Padding: most of the resume being about something else dilutes the match.
  const onTopic = bulletText.filter(relevantTo).length;
  const focusPct = bulletText.length && asked.length ? Math.round((onTopic / bulletText.length) * 100) : 100;
  let focusScore = 5;
  if (asked.length && bulletText.length >= 4 && focusPct < 50) {
    focusScore = focusPct < 30 ? 1 : 3;
    concerns.push({ id: "focus", severity: "medium", title: `Only ${focusPct}% of your bullets touch what the job asks for`,
      detail: "The rest dilutes the match.", fix: "Cut or shorten the bullets that are not relevant to this role." });
  }
  if (quantifiedPct >= 50) strengths.push(`${quantifiedPct}% of your bullets carry a number`);
  else concerns.push({ id: "impact", severity: quantifiedPct < 15 ? "high" : "medium", title: `Only ${quantifiedPct}% of bullets show a measurable result`,
    detail: "Numbers (users, time saved, revenue, size) are what a recruiter remembers.", fix: "Add the real figure to the bullets where you know it; do not estimate." });
  let clarityScore = (strongVerbPct >= 85 ? 5 : Math.round((strongVerbPct / 85) * 5)) + (avgWords >= 10 && avgWords <= 26 ? 5 : 2);
  const weakOpeners = bulletText.filter((t) => !startsWithVerb(t));
  if (strongVerbPct < 85 && weakOpeners.length) concerns.push({ id: "openers", severity: "low", title: `${weakOpeners.length} bullet${weakOpeners.length === 1 ? "" : "s"} do not start with an action verb`,
    detail: `For example: "${weakOpeners[0].slice(0, 70)}"`, fix: "Start with what you did: Built, Led, Reduced, Shipped." });
  const long = bulletText.filter((t) => wordCount(t) > 30);
  if (long.length) { clarityScore -= 2; concerns.push({ id: "long-bullets", severity: "low", title: `${long.length} bullet${long.length === 1 ? " is" : "s are"} over 30 words`, detail: "Long bullets are skimmed, not read.", fix: "One idea per bullet, about 12 to 24 words." }); }

  // ---- 4. the summary (10 points)
  const summary = (content.summary ?? "").trim();
  let summaryScore = 3;
  if (summary) {
    const fluff = summary.match(FLUFF_RE)?.[0];
    if (fluff) { summaryScore = 4; concerns.push({ id: "fluff", severity: "medium", title: `The summary uses filler ("${fluff}")`, detail: "Claims with no proof are what recruiters skim past, and sometimes distrust.", fix: "Say what you did and how well, with a fact from your experience." }); }
    else if (wordCount(summary) > 55) { summaryScore = 6; concerns.push({ id: "summary-long", severity: "low", title: "The summary is longer than a recruiter will read", detail: `${wordCount(summary)} words.`, fix: "Two sentences, under 50 words." }); }
    else if (numbersIn(summary).length === 0) {
      summaryScore = 6;
      concerns.push({ id: "summary-generic", severity: "low", title: "The summary has no proof in it", detail: "A claim with no fact behind it is the same as everyone else's.", fix: "Include one real result with a number from your experience." });
    } else { summaryScore = 10; strengths.push("The summary is short and carries a real result"); }
  } else concerns.push({ id: "no-summary", severity: "low", title: "No summary", detail: "The summary is the first thing read after the name.", fix: "Add two sentences: who you are for this role, and your strongest proof." });

  // ---- 5. credibility (10 points)
  let credScore = 10;
  const spans = content.experience.map((r) => ({ s: monthIndex(r.start, now), e: monthIndex(r.end, now) ?? (r.start ? monthIndex("present", now) : null), r })).filter((x) => x.s !== null);
  spans.sort((a, b) => (b.s as number) - (a.s as number));
  const gaps: string[] = [];
  for (let i = 0; i < spans.length - 1; i++) {
    const next = spans[i], prev = spans[i + 1];
    if (prev.e !== null && (next.s as number) - prev.e > 6) gaps.push(`${prev.r.company} to ${next.r.company}`);
  }
  if (gaps.length) { credScore -= 3; concerns.push({ id: "gap", severity: "low", title: `Gap of more than six months (${gaps[0]})`, detail: "Unexplained gaps prompt questions.", fix: "Add what you did in that time (study, freelance, caring, travel) if you are comfortable." }); }
  if (allSkills.length > 20) { credScore -= 3; concerns.push({ id: "skills-long", severity: "low", title: `${allSkills.length} skills listed`, detail: "Long lists read as padding.", fix: "Keep the ones you could be interviewed on, most relevant first." }); }
  const repeats = asked.map((s) => ({ s: s.name, n: bulletText.filter((t) => mentionsSkill(t, s.name)).length })).filter((x) => x.n > 4);
  if (repeats.length) { credScore -= 2; concerns.push({ id: "stuffing", severity: "medium", title: `${repeats[0].s} appears in ${repeats[0].n} bullets`, detail: "Repeating a keyword looks like stuffing.", fix: "Mention it where it mattered most." }); }
  const c = content.contact;
  if (!c.email || !(c.phone || c.linkedin)) { credScore -= 2; concerns.push({ id: "contact", severity: "medium", title: "Contact details are incomplete", detail: "A recruiter needs an email and a phone or LinkedIn.", fix: "Add them in the studio." }); }
  if (opts.pages && opts.pages > 2) { credScore -= 2; concerns.push({ id: "length", severity: "medium", title: `${opts.pages} pages`, detail: "Over two pages is rarely read.", fix: "Cut the oldest or least relevant bullets." }); }
  else if (opts.pages === 1 && bulletText.length > 0) strengths.push("Fits on one page");

  const score = Math.max(0, Math.min(100, Math.round(mustScore + levelScore + impactScore + leadScore + focusScore + Math.max(0, clarityScore) + summaryScore + Math.max(0, credScore))));
  const order: Record<ReviewSeverity, number> = { high: 0, medium: 1, low: 2 };
  concerns.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    score, verdict: score >= 80 ? "strong" : score >= 60 ? "good" : "needs_work", strengths, concerns, musts,
    stats: { bullets: bulletText.length, quantifiedPct, strongVerbPct, avgBulletWords: avgWords, years, requiredYears, skillsListed: allSkills.length },
  };
}
