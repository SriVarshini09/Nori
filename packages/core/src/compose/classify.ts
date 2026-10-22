import type { FormField } from "../contracts.js";

/** What an application question is really asking for. Drives which composer template answers it. */
export type QuestionKind =
  | "motivation_company" | "motivation_role" | "project_story" | "challenge_story" | "strengths" | "weaknesses"
  | "why_leaving" | "team_fit" | "availability" | "salary" | "cover_letter" | "anything_else" | "referral_source"
  | "relocation" | "portfolio_link" | "reference_contact" | "legal_identifier" | "acknowledgement" | "unknown";

/** Kinds answered with prose written by the agent (as opposed to facts or links). */
export const NARRATIVE_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([
  "motivation_company", "motivation_role", "project_story", "challenge_story", "strengths", "weaknesses",
  "why_leaving", "team_fit", "cover_letter", "anything_else",
]);

/** Kinds the composer answers from profile facts in a sentence or two. */
export const FACT_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([
  "availability", "salary", "referral_source", "relocation", "portfolio_link",
]);

/** Kinds the agent must never answer on the user's behalf. */
export const NEVER_COMPOSE: ReadonlySet<QuestionKind> = new Set<QuestionKind>(["reference_contact", "legal_identifier"]);

/** Every kind the composer handles (narrative + facts + unknown). */
export const FREE_TEXT_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([...NARRATIVE_KINDS, ...FACT_KINDS]);

type FieldLike = Pick<FormField, "kind"> & Partial<Pick<FormField, "options" | "required">>;

/** A field that takes typed prose: a textarea, or a text box with no fixed options. */
export function isFreeTextField(field: FieldLike): boolean {
  return (field.kind === "textarea" || field.kind === "text" || field.kind === "unknown") && !(field.options?.length);
}

/** Long-form answers (60 to 140 words) go in textareas and in long text boxes asking for a story. */
export function isLongForm(kind: QuestionKind, field: FieldLike): boolean {
  if (FACT_KINDS.has(kind) || NEVER_COMPOSE.has(kind) || kind === "anything_else") return false;
  if (field.kind === "textarea") return true;
  return kind === "cover_letter" || kind === "project_story" || kind === "challenge_story" || kind === "motivation_company" || kind === "motivation_role";
}

const LEGAL = /\b(ssn|sin|social security|social insurance|passport|date of birth|birth ?date|d\.?o\.?b\.?|national (id|insurance)|driver'?s licen[cs]e|tax (id|identification)|\bitin\b|aadhaar|government[- ]issued id)\b/;
const REFERENCE = /\breferences?\b|\breferee|reference (name|contact|email|phone)|former (manager|supervisor)'?s? (name|email|phone|contact)|can we contact your/;
const SALARY = /salary|compensation|pay (expectation|range|requirement)|desired (pay|rate)|expected (pay|rate)|rate expectation|hourly rate|\bpay\b.*expect/;
const AVAILABILITY = /start date|when (can|could|would) you (start|begin|join)|earliest (possible )?(start|date|availability)|available to start|available (to work|for|during)|availability|notice period|how much notice|graduat(e|ion) date|when do you graduate|dates? (are you|you are|you'?re) available|which (term|semester|season)/;
const REFERRAL = /(hear|heard|learn(ed)?|find|found) (out )?about (us|this|the)|how did you (find|hear|learn|discover|come across)|where did you (first )?(hear|find|see|learn|come across)|referral source|source of (this )?application|who referred you/;
const RELOCATION = /relocat|willing to move|open to moving|commut(e|ing) to|work (on-?site|in (the|our|an) office)|in[- ]office|able to work (on-?site|in person|from our)/;
const COVER = /cover letter|letter of (motivation|interest)|motivation(al)? letter/;
const ANYTHING = /anything else|additional (information|comments|info|details|notes)|is there anything|other (information|comments)|want us to know|would like (us )?to (share|know)|like to share|^comments?$|^notes?$|^additional$/;
const LEAVING = /why (are you |do you want to |did you )?(leav|looking to leave|look(ing)? for a new|left)|reason(s)? for (leaving|looking|change)|why.*(leave|leaving|left) (your )?(current|last|previous|present)|why (now|change jobs)/;
const MOTIVATION = /why (are you |do you |would you )?(want|interested|apply|applying|join|like to)|why (us|here|this (company|team|role|position|job|internship))|what (excites|interests|draws|attracts|appeals to|motivates) you|interests? you (about|in)|what about (us|our)|motivat|why do you want|why .{0,40}\binterest(ed)?\b|^why (?!should)[a-z0-9.&' -]{2,25}\?$/;
const COMPANY_HINT = /\b(us|our|company|here|mission|product|products|team at|work(ing)? at|intern(ing)? at|join(ing)? (us|the team)|the way we)\b/;
const ROLE_HINT = /\b(role|position|job|opportunity|internship|this team|this work)\b/;
const WEAK = /weakness|areas? (for|of) (improvement|growth)|(want|need) to improve|improve on|working on improving|struggle with|development area|growth area/;
const STRENGTH = /strength|what makes you (a )?(good|great|strong|unique)|sets you apart|why should we (hire|choose)|superpower|what (would|will|can) you bring|unique(ly)? qualif|about yourself|introduce yourself|tell (us|me) about you\b|describe yourself|best qualif|good fit|great fit|strong fit/;
const PROJECT = /project|something you('ve| have)? (built|made|created|shipped)|you'?ve built|you have built|proud(est)?|accomplishment|achievement|shipped|side project|favorite thing you/;
const CHALLENGE = /challeng|difficult|obstacle|conflict|fail(ure|ed)?\b|mistake|hardest|tough(est)?|setback|problem you solved|went wrong/;
const TEAM = /\bteam\b|collaborat|work(ing)? style|culture|environment|manag(er|ed|ement) style|feedback|disagree|cross[- ]functional|work with (others|designers|engineers|product)/;
const PORTFOLIO = /\b(url|link|portfolio|website|web site|github|gitlab|personal (site|page)|code samples?)\b/;
const ASKS_PROSE = /\b(why|describe|tell|explain|what|how|share (a|an|your) (story|example))\b/;

/** Classify an application question from its label, using the field kind to break ties. */
export function classifyQuestion(label: string, field?: FieldLike): QuestionKind {
  const l = label.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  if (!l) return "unknown";
  const prose = field?.kind === "textarea";

  if (LEGAL.test(l)) return "legal_identifier";
  if (REFERENCE.test(l) && !/referr?al source|referred/.test(l)) return "reference_contact";
  if (SALARY.test(l)) return "salary";
  if (REFERRAL.test(l)) return "referral_source";
  if (AVAILABILITY.test(l) && !MOTIVATION.test(l)) return "availability";
  if (RELOCATION.test(l)) return "relocation";
  if (COVER.test(l)) return "cover_letter";
  if (LEAVING.test(l)) return "why_leaving";
  if (/why should (we|i|you) (hire|choose|pick|consider)/.test(l)) return "strengths";
  if (MOTIVATION.test(l) && !PROJECT.test(l.replace(/the way (we|you) build|what we build|we('re| are) building/g, ""))) {
    if (COMPANY_HINT.test(l) || /\bat [a-z0-9]/.test(l) && !/\bat (this|the) (role|position|job)/.test(l)) return "motivation_company";
    if (ROLE_HINT.test(l)) return "motivation_role";
    return "motivation_company";
  }
  if (WEAK.test(l)) return "weaknesses";
  if (STRENGTH.test(l)) return "strengths";
  if (PORTFOLIO.test(l) && !ASKS_PROSE.test(l) && !prose) return "portfolio_link";
  if (PROJECT.test(l)) return "project_story";
  if (CHALLENGE.test(l)) return "challenge_story";
  if (TEAM.test(l)) return "team_fit";
  if (ANYTHING.test(l)) return "anything_else";
  if (PORTFOLIO.test(l) && !ASKS_PROSE.test(l)) return "portfolio_link";
  return "unknown";
}
