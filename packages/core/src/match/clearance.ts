import type { JobRequirements } from "../db/schema.js";

/**
 * Does this posting restrict who can apply to US citizens or people who can hold a government clearance?
 * Visa holders (a core audience) cannot take these roles, so the jobs page can hide them.
 *
 * Works sentence by sentence: a sentence counts when it states a restriction and does not negate it ("we do not
 * require a clearance", "citizens of any country") or make it optional ("TS/SCI preferred", "a plus").
 * Deliberately conservative: a bare mention of "clearance" or "citizen" is not enough.
 */
export type ClearanceJob = {
  title: string;
  descriptionText?: string | null;
  requirements?: Pick<JobRequirements, "mustHaves" | "disqualifiers"> | null;
};

const US = String.raw`(?:us|u\s?s\s?a|united\s+states(?:\s+of\s+america)?|american)`;
// Words that turn a mention of US citizenship into a requirement.
const CUE = String.raw`(?:must|required?|requires?|requiring|requirement|necessary|mandatory|only|eligib\w+|able\s+to|ability\s+to|need|needs|needed|restricted|limited|obtain|maintain|hold|holds|possess|proof\s+of|verif\w+|prove|to\s+be\s+(?:an?\s+)?${US})`;

const POSITIVE: RegExp[] = [
  // US citizenship / "citizen of the United States", with a requirement cue in the same sentence.
  new RegExp(String.raw`(?<!non[-\s])\b(?:${US}\s+citizen(?:s|ship)?|citizens?\s+of\s+the\s+${US})\b`, "i"),
  // Clearances: named levels and qualified "clearance".
  /\b(?:ts\s*\/\s*sci|ts-sci|tssci|top[\s-]secret)\b/i,
  /\b(?:secret|dod|doe|department\s+of\s+defense|security|government|federal|national\s+security|nato|public\s+trust|q|l)\s+(?:level\s+)?(?:security\s+)?clearances?\b/i,
  /\b(?:active|current|interim|valid)\s+(?:us\s+)?(?:clearance|secret|ts)\b/i,
  /\beligib\w+\s+(?:for|to\s+obtain|to\s+hold|to\s+get)\s+(?:an?\s+)?(?:\w+\s+){0,2}clearance\b/i,
  /\b(?:obtain|maintain|hold|possess)\s+(?:and\s+(?:maintain|hold)\s+)?(?:an?\s+)?(?:active\s+)?(?:us\s+)?(?:government\s+)?clearance\b/i,
  /\bpolygraph\b|\b(?:full[\s-]scope|ci|lifestyle)\s+poly\b/i,
  // Export control / ITAR.
  /\bitar\b/i,
  /\b22\s*c\.?f\.?r\.?\s*(?:§\s*)?120\b/i,
  new RegExp(String.raw`\b${US}\s+persons?\b`, "i"),
];

// Which positive patterns need a requirement cue in the sentence (bare "US citizen" or "US person" is not enough).
const NEEDS_CUE = new Set<RegExp>([POSITIVE[0], POSITIVE[POSITIVE.length - 1]]);
const CUE_RE = new RegExp(String.raw`\b${CUE}\b`, "i");
// "US person" is only restrictive in an export-control sense.
const EXPORT_CONTEXT = /\b(?:export|itar|ear\b|22\s*cfr|defined\s+(?:by|in|under)|must|required|only|eligib\w+)/i;

const TRIGGER = String.raw`(?:citizen\w*|clearances?|polygraph|itar|us\s+persons?)`;
const NEGATIONS: RegExp[] = [
  // "we do not require a clearance", "does not necessarily need US citizenship"
  new RegExp(String.raw`\b(?:do|does|did|will|would|can|could)\s*(?:not|n'?t)\s+(?:\w+\s+){0,3}?(?:require|need|necessitate|demand)\b(?:\W+\w+){0,6}?\W+${TRIGGER}`, "i"),
  // "no clearance required", "without a security clearance", "no US citizenship needed"
  new RegExp(String.raw`\b(?:no|without)\W+(?:\w+\W+){0,3}?(?:clearances?|citizenship|polygraph)\b`, "i"),
  // "clearance is not required", "citizenship isn't needed"
  new RegExp(String.raw`\b(?:clearances?|citizenship|polygraph)\b(?:\W+\w+){0,3}?\W+(?:is|are)?\s*(?:not|n'?t)\s*(?:required|needed|necessary|mandatory)`, "i"),
  // "citizens of any country", "regardless of citizenship", "non-US citizens welcome"
  /\b(?:any|all)\s+(?:country|countries|nationality|nationalities)\b|\bregardless\s+of\s+(?:your\s+)?(?:citizenship|nationality|national\s+origin|immigration)\b|\bnon[-\s](?:us|u\s?s|american)\s+citizens?\b/i,
];

const OPTIONAL = /\b(?:preferred|a\s+plus|nice\s+to\s+have|desirable|bonus|beneficial|helpful|an?\s+asset|not\s+required\s+but|would\s+be\s+great)\b/i;

// Title-only signals ("Cleared Systems Engineer", "Software Engineer (TS/SCI)").
const TITLE_RE = /\b(?:ts\s*\/\s*sci|ts-sci|top[\s-]secret|cleared|polygraph|(?:secret|ts)\s+clearance|clearance\s+required)\b/i;

/** "U.S." -> "US", "D.o.D." -> "DoD", so the periods do not split sentences. */
function normalise(text: string): string {
  return text
    .replace(/\bu\.\s?s\.(?:\s?a\.)?/gi, "US")
    .replace(/\bd\.\s?o\.\s?d\.?/gi, "DoD")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " "));
}

function sentences(text: string): string[] {
  return normalise(text).split(/(?<=[.!?])\s+|[\n\r•·;|]+/).map((s) => s.trim()).filter(Boolean);
}

function sentenceRestricts(s: string): boolean {
  const hit = POSITIVE.find((re) => {
    if (!re.test(s)) return false;
    if (!NEEDS_CUE.has(re)) return true;
    if (!CUE_RE.test(s)) return false;
    // "US person" outside an export-control sentence is just English ("US persons in the audience").
    return re === POSITIVE[POSITIVE.length - 1] ? EXPORT_CONTEXT.test(s) : true;
  });
  if (!hit) return false;
  if (NEGATIONS.some((n) => n.test(s))) return false;
  if (OPTIONAL.test(s)) return false;
  return true;
}

export function needsUsCitizenshipOrClearance(job: ClearanceJob): boolean {
  if (TITLE_RE.test(job.title)) return true;
  const parts = [job.descriptionText ?? "", ...(job.requirements?.mustHaves ?? []), ...(job.requirements?.disqualifiers ?? [])];
  for (const part of parts) {
    if (!part) continue;
    for (const s of sentences(part)) if (sentenceRestricts(s)) return true;
  }
  return false;
}
