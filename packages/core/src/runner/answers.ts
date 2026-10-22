import type { ApplicantProfile, Evidence, FormField } from "../contracts.js";
import { getLLM, withFallback } from "../llm/index.js";
import type { CompanyResearch, Eeo, ResumeContent, SalaryExpectation, WorkAuth, profiles } from "../db/schema.js";
import { FREE_TEXT_KINDS, NEVER_COMPOSE, classifyQuestion, isFreeTextField, type QuestionKind } from "../compose/classify.js";
import { composeAnswer, type ComposeInput, type ComposeJob } from "../compose/compose.js";
import { foreignWorkCountry } from "./work-country.js";

type ProfileRow = typeof profiles.$inferSelect;

/**
 * ApplicantProfile plus the onboarding answers ATS forms keep asking. A structural superset of the
 * contract type, so it flows through DriverContext unchanged while the heuristic answerer reads the extras.
 */
export type ApplicantProfileFull = ApplicantProfile & {
  city?: string; state?: string; pronouns?: string;
  workAuth: ApplicantProfile["workAuth"] & Pick<WorkAuth, "status" | "visaType">;
  willingToRelocate?: boolean;
  remotePreference?: string;
  heardAbout?: string;
  salaryExpectation?: SalaryExpectation;
  earliestStartDate?: string;
  noticePeriodWeeks?: number;
  eeo?: Partial<Eeo>;
  securityClearance?: string;
  over18?: boolean;
};

// ---------- geography ----------

export const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", UK: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France",
  NL: "Netherlands", ES: "Spain", PT: "Portugal", IT: "Italy", SE: "Sweden", CH: "Switzerland", PL: "Poland", IN: "India",
  AU: "Australia", NZ: "New Zealand", SG: "Singapore", JP: "Japan", IL: "Israel", BR: "Brazil", MX: "Mexico",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (hay: string, w: string) => new RegExp(`(^|[^a-z])${escapeRe(w.toLowerCase())}([^a-z]|$)`).test(hay.toLowerCase());

/** The US state in a free-text location ("San Francisco, CA", "Austin, Texas, USA"), if any. */
export function inferState(location?: string | null): { abbr: string; name: string } | undefined {
  if (!location) return undefined;
  const segs = location.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segs.slice(1).concat(segs.length === 1 ? segs : [])) {
    const words = seg.replace(/\d{5}(-\d{4})?/, "").trim();
    for (const [abbr, name] of US_STATES) {
      if (words.toUpperCase() === abbr || words.toLowerCase() === name.toLowerCase()) return { abbr, name };
    }
  }
  for (const [abbr, name] of US_STATES) if (hasWord(location, name)) return { abbr, name };
  return undefined;
}

/** Country of residence as a display name: profile.country (ISO or name), else inferred from the location. */
export function inferCountry(profile: Pick<ApplicantProfile, "country" | "location">): string | undefined {
  const c = profile.country?.trim();
  if (c) return COUNTRY_NAMES[c.toUpperCase()] ?? c;
  const loc = profile.location ?? "";
  if (!loc) return undefined;
  if (/\b(usa|u\.s\.a?\.?|united states|us)\b/i.test(loc) || inferState(loc)) return "United States";
  const last = loc.split(",").pop()!.trim().toLowerCase();
  return Object.values(COUNTRY_NAMES).find((n) => n.toLowerCase() === last);
}

function countryAliases(name: string): string[] {
  const n = name.toLowerCase();
  if (n === "united states") return ["united states of america", "united states", "usa", "u.s.", "us"];
  if (n === "united kingdom") return ["united kingdom", "uk", "great britain", "england"];
  return [n];
}

const isoOf = (name?: string) => (name ? Object.entries(COUNTRY_NAMES).find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0] : undefined);

// ---------- profile ----------

/** Build the driver's ApplicantProfile from the profiles row (and the user's email as fallback). */
export function toApplicantProfile(p: ProfileRow, fallbackEmail = ""): ApplicantProfileFull {
  const fullName = (p.fullName ?? "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const wa = (p.workAuth ?? {}) as Record<string, unknown>;
  // Older rows kept github and country in preferences; the columns win when set.
  const prefs = (p.preferences ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const city = str(p.city);
  const state = str(p.state);
  const rawCountry = str(p.country) ?? str(prefs.country);
  const location = str(p.location) ?? ([city, state, rawCountry].filter(Boolean).join(", ") || undefined);
  const country = rawCountry
    ? (rawCountry.length <= 3 ? rawCountry.toUpperCase() : isoOf(rawCountry) ?? rawCountry)
    : isoOf(inferCountry({ location }));
  const status = str(wa.status);
  const salary = p.salaryExpectation && typeof p.salaryExpectation.amount === "number" && p.salaryExpectation.amount > 0
    ? p.salaryExpectation : undefined;
  return {
    fullName,
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
    email: p.email ?? fallbackEmail,
    phone: p.phone ?? undefined,
    linkedin: p.linkedin ?? undefined,
    website: p.website ?? undefined,
    github: str(p.github) ?? str(prefs.github),
    location,
    country,
    city,
    state,
    pronouns: str(p.pronouns),
    workAuth: {
      authorizedUS: bool(wa.authorizedUS),
      needsSponsorship: bool(wa.needsSponsorship),
      notes: typeof wa.notes === "string" ? wa.notes : undefined,
      status: (["citizen", "permanent_resident", "visa", "other"] as const).find((s) => s === status),
      visaType: str(wa.visaType),
    },
    willingToRelocate: p.willingToRelocate ?? undefined,
    remotePreference: str(p.remotePreference),
    heardAbout: str(p.heardAbout),
    salaryExpectation: salary,
    earliestStartDate: str(p.earliestStartDate),
    noticePeriodWeeks: typeof p.noticePeriodWeeks === "number" ? p.noticePeriodWeeks : undefined,
    eeo: p.eeo ?? undefined,
    securityClearance: str(p.securityClearance),
    over18: p.over18 ?? undefined,
  };
}

/**
 * Fields the driver fills straight from the profile (names, contact, links, location, country, resume).
 * These are never persisted as answers: they are re-derived from the current profile on every run.
 */
export function isProfileField(label: string): boolean {
  const l = label.toLowerCase();
  return /\b(first|last|full|middle|preferred|legal|given|family|sur)?\s*name\b|e-?mail|phone|mobile|telephone|\blocation\b|\bcity\b|address|zip|postal|linkedin|website|portfolio|github|personal (site|url)|countr|resume|\bcv\b|cover letter/.test(l)
    && !/why|describe|tell us|explain/.test(l);
}

// ---------- heuristic answers ----------

const YES_RE = /^\s*yes\b/i;
const NO_RE = /^\s*no\b/i;
const hasYesNo = (opts: string[]) => opts.some((o) => YES_RE.test(o)) && opts.some((o) => NO_RE.test(o));

/** Pick the option that reads as yes/no, or the bare word when the field is free text. */
function yesNo(field: FormField, yes: boolean): string {
  const opt = field.options?.find((o) => (yes ? YES_RE : NO_RE).test(o));
  return opt ?? (yes ? "Yes" : "No");
}

/** First option matching any pattern, in pattern order, skipping options matching `avoid`. */
function pick(options: string[] | undefined, patterns: RegExp[], avoid?: RegExp): string | undefined {
  for (const re of patterns) {
    const hit = options?.find((o) => re.test(o) && !(avoid && avoid.test(o)));
    if (hit) return hit;
  }
  return undefined;
}

/** Multi-option checkboxes split values on , ; | so return a prefix the driver can still match by startsWith. */
function choiceValue(field: FormField, option: string): string {
  if (field.kind !== "checkbox" || (field.options?.length ?? 0) <= 1) return option;
  return option.split(/[;,|]/)[0].trim() || option;
}

function countryOption(field: FormField, country: string): string | undefined {
  const aliases = countryAliases(country);
  const opts = field.options ?? [];
  return opts.find((o) => aliases.includes(o.trim().toLowerCase()))
    ?? opts.find((o) => aliases.some((a) => a.length > 2 && hasWord(o, a)))
    ?? opts.find((o) => aliases.some((a) => hasWord(o, a)));
}

const EEO_RE = /\b(gender|sex|race|racial|ethnicity|ethnic|hispanic|latin[oax]|veteran|disability|disabled|sexual orientation|transgender)\b/;
const DECLINE_RES = [/decline/i, /prefer not/i, /(don'?t|do not|choose not|not) (wish|want|to (say|answer|disclose|self.identify|identify))/i, /not (to )?specif/i];
const ACK_RE = /acknowledg|privacy (notice|policy|statement)|double.?check|i (have read|agree|understand|confirm|certify|consent|attest)|by (checking|submitting)|terms (and|&) conditions|(accurate|true) and complete|candidate (privacy|data)|gdpr/;
const AUTH_RE = /(authori[sz]ed|eligible|legally|right|permitted) to work|work authori[sz]ation|work permit|employment eligibility|immigration status|citizenship status/;
const HEAR_RE = /(hear|heard|learn(ed)?|find|found) (out )?about (us|this|the)|how did you (find|hear|learn|discover)|where did you (first )?(hear|find|see|learn)|referral source/;

const SALARY_RE = /salary|compensation|pay (expectation|range|requirement)|desired (pay|rate)|expected (pay|rate)|rate expectation/;
const START_RE = /start date|when (can|could|would) you (start|begin|join)|earliest (possible )?(start|date|availability)|available to start|availability (to start|date)|date (you are )?available/;
const NOTICE_RE = /notice period|how much notice|weeks'? notice/;
const CLEARANCE_RE = /security clearance|\bclearance\b/;
const ADULT_RE = /(18|eighteen) years|over (the age of )?18|age of (18|eighteen)|at least 18|18 or older|legal (working )?age/;
const RELOCATE_RE = /relocat/;

function eeoCategory(l: string): keyof Eeo | undefined {
  if (/veteran/.test(l)) return "veteran";
  if (/disab/.test(l)) return "disability";
  if (/race|racial|ethnic|hispanic|latin[oax]/.test(l)) return "race";
  if (/gender|sex|transgender/.test(l)) return "gender";
  return undefined;
}

const isDecline = (o: string) => DECLINE_RES.some((re) => re.test(o));

/** EEO: the option naming the user's chosen value, else a decline option. */
function eeoAnswer(field: FormField, l: string, eeo: Partial<Eeo> | undefined): string | null {
  const opts = field.options ?? [];
  const decline = () => pick(opts, DECLINE_RES) ?? null;
  const cat = eeoCategory(l);
  const chosen = (cat && eeo?.[cat]?.trim()) || "decline";
  const v = chosen.toLowerCase();
  if (/^(decline|prefer not|n\/a)/.test(v)) return decline();
  if (!opts.length) return field.kind === "text" || field.kind === "textarea" ? chosen : null;
  const open = opts.filter((o) => !isDecline(o));
  if (hasYesNo(opts) && (v === "yes" || v === "no")) return yesNo(field, v === "yes");
  // Hispanic/Latino asked as its own yes/no question.
  if (hasYesNo(opts) && /hispanic|latin/.test(l)) return yesNo(field, /hispanic|latin/.test(v));
  const hit = open.find((o) => o.trim().toLowerCase() === v)
    ?? open.find((o) => hasWord(o, v))
    ?? open.find((o) => v.length > 3 && o.trim().length > 2 && hasWord(v, o.trim()));
  if (hit) return hit;
  if (cat === "veteran" && /^(no|not)\b/.test(v)) return pick(open, [/not a (protected )?veteran/i, /^\s*no\b/i, /\bnot\b/i]) ?? decline();
  if (cat === "disability" && /^(no|not)\b/.test(v)) return pick(open, [/^\s*no\b/i, /do not have/i]) ?? decline();
  return decline();
}

const nums = (s: string) => [...s.toLowerCase().replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k\b)?/g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1));

function salaryAnswer(field: FormField, l: string, s: SalaryExpectation | undefined): string | null {
  if (!s?.amount) return null;
  const opts = field.options ?? [];
  if (opts.length) {
    // Range options ("$100,000 - $150,000", "150k+", "Under 80k"): the one containing the amount.
    for (const o of opts) {
      const n = nums(o);
      if (n.length >= 2 && s.amount >= n[0] && s.amount <= n[1]) return o;
      if (n.length === 1 && /\+|above|over|more|or higher/i.test(o) && s.amount >= n[0]) return o;
      if (n.length === 1 && /under|below|less|up to/i.test(o) && s.amount < n[0]) return o;
    }
    return null;
  }
  if (/number|numeric|digits only|numbers only/.test(l)) return String(s.amount);
  const per = s.period ? ` per ${s.period}` : "";
  return `${s.amount.toLocaleString("en-US")} ${s.currency ?? "USD"}${per}`;
}

/** The work-authorization option matching citizen / permanent resident / visa wording. */
function statusOption(opts: string[], status: NonNullable<WorkAuth["status"]>, visaType?: string): string | undefined {
  const NEG = /\bnot\b|\bnon[- ]?(citizen|resident)/i;
  if (status === "citizen") return pick(opts, [/citizen(?! or (a )?(lawful )?permanent)/i, /citizen/i], NEG);
  if (status === "permanent_resident") return pick(opts, [/permanent resident|green card|lawful permanent/i, /permanent/i], NEG);
  if (status === "visa") {
    const squash = (s: string) => s.toLowerCase().replace(/[-\s]/g, "");
    const byType = visaType ? opts.find((o) => squash(o).includes(squash(visaType))) : undefined;
    return byType ?? pick(opts, [/\bvisa\b|h-?1b|\bopt\b|\bead\b|\btn\b|work permit|temporary/i], /\bnot authori/i);
  }
  return pick(opts, [/^\s*other\b/i]);
}

/** Deterministic answers from the profile. Returns null for anything it cannot answer from facts. */
export function heuristicAnswer(field: FormField, profile: ApplicantProfile | ApplicantProfileFull): string | null {
  const l = field.label.toLowerCase().replace(/\s+/g, " ");
  const opts = field.options ?? [];
  const full = profile as ApplicantProfileFull;
  const wa = full.workAuth;
  const out = (v: string | undefined | null) => (v ? choiceValue(field, v) : null);

  // EEO self-identification: the user's choice from onboarding, decline by default.
  if (EEO_RE.test(l) && !/sponsor|authori[sz]/.test(l)) return out(eeoAnswer(field, l, full.eeo));

  // Preferred name: the first name, never something the person did not give.
  if (/\b(preferred|nick|chosen|goes by|what (should|do) we call)\b.{0,20}\bname\b|\bnickname\b/.test(l) && !/\b(last|family|sur|middle|legal|company|employer)\b/.test(l)) {
    return full.firstName ? out(full.firstName) : null;
  }

  // Pronouns: only what the person told us. A guess here would be wrong about a person.
  if (/\bpronouns?\b/.test(l)) {
    if (!full.pronouns) return null;
    if (!opts.length) return full.pronouns;
    const want = full.pronouns.toLowerCase().replace(/\s+/g, "");
    return out(opts.find((o) => o.toLowerCase().replace(/\s+/g, "") === want)
      ?? opts.find((o) => o.toLowerCase().replace(/\s+/g, "").includes(want) || want.includes(o.toLowerCase().replace(/\s+/g, "")) && o.length > 3));
  }

  // "Which U.S. state or Canadian province do you live in?": the state on the profile (or inferred from the location).
  if (/\b(state|province|region)\b/.test(l) && /\b(reside|live|living|located|based|home)\b/.test(l) && !/(one of|any of|following|these|listed)/.test(l)) {
    const st = full.state ? inferState(full.state) ?? { abbr: full.state.toUpperCase(), name: full.state } : inferState(profile.location);
    if (!st) return null;
    if (!opts.length) return st.name;
    return out(opts.find((o) => o.trim().toLowerCase() === st.name.toLowerCase())
      ?? opts.find((o) => hasWord(o, st.name))
      ?? opts.find((o) => o.trim().toUpperCase() === st.abbr || new RegExp(`(^|[^A-Za-z])${st.abbr}([^A-Za-z]|$)`).test(o)));
  }

  // Salary: the expected amount, or blank when the user gave none.
  if (SALARY_RE.test(l)) return out(salaryAnswer(field, l, full.salaryExpectation));

  if (NOTICE_RE.test(l)) {
    const w = full.noticePeriodWeeks;
    if (w === undefined) return null;
    if (!opts.length) return w === 0 ? "None, available immediately" : `${w} week${w === 1 ? "" : "s"}`;
    return out(opts.find((o) => nums(o)[0] === w && /week/i.test(o))
      ?? (w === 0 ? pick(opts, [/immediate|none|no notice/i]) : undefined)
      ?? opts.find((o) => /month/i.test(o) && nums(o)[0] !== undefined && nums(o)[0] * 4 === w));
  }

  if (START_RE.test(l)) {
    if (opts.length) return null;
    if (full.earliestStartDate) return full.earliestStartDate;
    const w = full.noticePeriodWeeks;
    if (w === undefined) return null;
    return w === 0 ? "Immediately" : `${w} week${w === 1 ? "" : "s"} after an offer`;
  }

  if (CLEARANCE_RE.test(l)) {
    const c = full.securityClearance;
    if (!c) return null;
    const none = /^(none|no|n\/a|not applicable)$/i.test(c);
    if (hasYesNo(opts) || (!opts.length && /^(do|are|have|will|can) you/.test(l))) return yesNo(field, !none);
    if (!opts.length) return none ? "None" : c;
    return out(opts.find((o) => hasWord(o, c)) ?? (none ? pick(opts, [/^\s*none\b/i, /^\s*no\b/i, /not (hold|have)/i]) : undefined));
  }

  if (ADULT_RE.test(l)) return full.over18 === undefined ? null : yesNo(field, full.over18);

  if (RELOCATE_RE.test(l) && full.willingToRelocate !== undefined && (!opts.length || hasYesNo(opts))) return yesNo(field, full.willingToRelocate);

  // The profile's work authorization is about the US: a question about another country goes to the person.
  if ((/sponsor/.test(l) || AUTH_RE.test(l)) && foreignWorkCountry(field.label)) return null;

  if (/sponsor/.test(l)) {
    if (wa.needsSponsorship !== undefined) return yesNo(field, wa.needsSponsorship);
    return wa.authorizedUS === true ? yesNo(field, false) : null;
  }

  if (AUTH_RE.test(l)) {
    const choices = opts.length > 0 && !hasYesNo(opts);
    if (choices && wa.status) {
      const byStatus = statusOption(opts, wa.status, wa.visaType);
      if (byStatus) return out(byStatus);
    }
    if (wa.authorizedUS === undefined) return null;
    if (!choices) return yesNo(field, wa.authorizedUS);
    if (!wa.authorizedUS) return null;
    return out(pick(opts, [/citizen/i, /permanent/i, /authori[sz]ed/i], /\bnot\b|require|need|sponsor/i));
  }

  if (/countr/.test(l) && !/citizenship|code|phone|dial/.test(l)) {
    const country = inferCountry(profile);
    if (!country) return null;
    if (/(any|one) of (these|the following)|following countr|these countr|listed countr/.test(l) || hasYesNo(opts)) {
      const choices = opts.filter((o) => !YES_RE.test(o) && !NO_RE.test(o));
      if (opts.length && !hasYesNo(opts)) return out(countryOption(field, country));
      const listed = countryAliases(country).some((a) => hasWord(l, a)) || choices.some((o) => countryAliases(country).some((a) => hasWord(o, a)));
      return yesNo(field, listed);
    }
    if (opts.length) return out(countryOption(field, country));
    return country;
  }

  if (/(?<!united )states\b/.test(l) && /(one of|any of|following|these|listed)/.test(l)) {
    const state = inferCountry(profile) === "United States" || !profile.country ? inferState(profile.location) : undefined;
    const choices = opts.filter((o) => !YES_RE.test(o) && !NO_RE.test(o));
    if (choices.length && !hasYesNo(opts)) {
      return state ? out(choices.find((o) => hasWord(o, state.name) || o.trim().toUpperCase() === state.abbr)) : null;
    }
    const listed = !!state && (hasWord(l, state.name) || new RegExp(`(^|[^A-Za-z])${state.abbr}([^A-Za-z]|$)`).test(field.label));
    return yesNo(field, listed);
  }

  if (HEAR_RE.test(l)) {
    const h = full.heardAbout;
    if (h) {
      if (!opts.length) return h;
      const hit = opts.find((o) => o.trim().toLowerCase() === h.toLowerCase()) ?? opts.find((o) => hasWord(o, h))
        ?? opts.find((o) => { const head = o.split(/[(,/]/)[0].trim(); return head.length > 2 && hasWord(h, head); });
      if (hit) return out(hit);
    }
    if (!opts.length) return "Job board";
    return out(pick(opts, [/job board/i, /\bother\b/i, /website|careers? (page|site)|company site/i]) ?? null);
  }

  if (ACK_RE.test(l)) {
    if (field.kind === "email" || (/email/.test(l) && field.kind === "text")) return profile.email || null;
    if (!opts.length || (field.kind === "checkbox" && opts.length <= 1)) return "Yes";
    return out(pick(opts, [YES_RE, /i (agree|acknowledge|confirm|understand|have read|consent)/i, /acknowledg|agree|confirm|consent|understand/i], /\bnot\b|disagree|^\s*no\b/i));
  }

  if (/linkedin/.test(l)) return profile.linkedin ?? null;
  if (/github/.test(l)) return profile.github ?? profile.website ?? null;
  if (/website|portfolio|personal (site|url)/.test(l)) return profile.website ?? profile.github ?? null;
  if (/^(current )?(location|city)\b|where are you (located|based)|current location/.test(l)) return profile.location ?? null;
  return null;
}

// ---------- education ----------

/** An education node from the career graph. Dates are "YYYY" or "YYYY-MM". */
export type EducationFact = { label: string; startDate?: string | null; endDate?: string | null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SEASON_MONTH: Record<string, number> = { spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12 };
/** A year with no month is read as a May graduation (the usual US commencement month). */
const DEFAULT_GRAD_MONTH = 5;

/** "2027-05" / "2027" -> { y, m } (m null when the node only has a year). */
function ymOf(d?: string | null): { y: number; m: number | null } | null {
  const mt = d?.match(/^(\d{4})(?:-(\d{1,2}))?/);
  return mt ? { y: Number(mt[1]), m: mt[2] ? Number(mt[2]) : null } : null;
}

/** "December 2026", "Dec 15, 2026", "12/2026", "2026-12", "Fall 2026" -> { y, m }. */
function parseLooseDate(s: string, end: boolean): { y: number; m: number } | null {
  const t = s.trim().toLowerCase();
  let mt = t.match(/^(\d{4})-(\d{1,2})/);
  if (mt) return { y: Number(mt[1]), m: Number(mt[2]) };
  mt = t.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})/);
  if (mt) return { y: Number(mt[2]), m: Number(mt[1]) };
  const year = t.match(/\b(\d{4})\b/)?.[1];
  const yy = t.match(/'(\d{2})\b/)?.[1];
  const y = year ? Number(year) : yy ? 2000 + Number(yy) : null;
  if (!y) return null;
  const mi = MONTHS.findIndex((name) => new RegExp(`\\b${name.slice(0, 3).toLowerCase()}`).test(t));
  if (mi >= 0) return { y, m: mi + 1 };
  const season = Object.keys(SEASON_MONTH).find((k) => t.includes(k));
  if (season) return { y, m: SEASON_MONTH[season] };
  return { y, m: end ? 12 : 1 };
}

/** The education that matters for an application: in progress or most recently finished. */
function primaryEducation(edu: EducationFact[]): EducationFact | undefined {
  return [...edu].sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0];
}

function monthOption(field: FormField, m: number): string | null {
  const name = MONTHS[m - 1];
  const opts = field.options ?? [];
  if (!opts.length) return name;
  return opts.find((o) => o.trim().toLowerCase() === name.toLowerCase())
    ?? opts.find((o) => o.trim().toLowerCase().startsWith(name.slice(0, 3).toLowerCase()))
    ?? opts.find((o) => /^\d{1,2}$/.test(o.trim()) && Number(o.trim()) === m) ?? null;
}

function yearOption(field: FormField, y: number): string | null {
  const opts = field.options ?? [];
  if (!opts.length) return String(y);
  return opts.find((o) => o.trim() === String(y)) ?? opts.find((o) => new RegExp(`\\b${y}\\b`).test(o)) ?? null;
}

const SEASON_RE = /\b(winter|spring|summer|fall|autumn)\b/i;

/**
 * Education and term questions answered from graph education nodes and the job title. Returns undefined when
 * the field is not one of these questions, null when it is but the graph lacks the date.
 *  - "Start date month" / "End date year" / "Graduation month": the education node's dates, as an option
 *  - "Do you expect to graduate between December 2026 and June 2027?": Yes only if the end date is in the window
 *  - "Please confirm which term (Winter 2027 vs. Summer 2027)": the option whose season the job title names
 */
export function educationAnswer(field: FormField, education: EducationFact[], jobTitle: string): string | null | undefined {
  const l = field.label.toLowerCase().replace(/\s+/g, " ").trim();
  const opts = field.options ?? [];

  // Term / cohort confirmation, from the job title.
  const termQ = /\b(term|semester|season|session|cohort)\b/.test(l) && (SEASON_RE.test(l) || opts.some((o) => SEASON_RE.test(o)));
  if (termQ) {
    const season = jobTitle.match(SEASON_RE)?.[1]?.toLowerCase();
    if (!season) return null;
    const year = jobTitle.match(/\b(20\d{2})\b/)?.[1] ?? (jobTitle.match(/'(\d{2})\b/) ? `20${jobTitle.match(/'(\d{2})\b/)![1]}` : undefined);
    const fits = (o: string) => o.toLowerCase().includes(season) || (season === "fall" && /autumn/i.test(o)) || (season === "autumn" && /\bfall\b/i.test(o));
    if (opts.length) {
      const hits = opts.filter(fits);
      const choice = (year && hits.find((o) => o.includes(year))) || hits[0];
      return choice ? choiceValue(field, choice) : null;
    }
    // Free text: echo the matching term from the label ("Winter 2027"), else the season and year.
    const fromLabel = field.label.match(new RegExp(`\\b(${season}|${season === "fall" ? "autumn" : season})\\s*'?\\d{2,4}`, "i"))?.[0];
    return fromLabel ?? `${season[0].toUpperCase()}${season.slice(1)}${year ? ` ${year}` : ""}`;
  }

  const edu = primaryEducation(education);

  // Graduation window.
  const win = l.match(/graduat\w*.*?between\s+(.+?)\s+and\s+(.+?)\s*\??$/);
  if (win) {
    const end = ymOf(edu?.endDate);
    const a = parseLooseDate(win[1], false), b = parseLooseDate(win[2], true);
    if (!end || !a || !b) return null;
    const v = end.y * 12 + (end.m ?? DEFAULT_GRAD_MONTH);
    return yesNo(field, v >= a.y * 12 + a.m && v <= b.y * 12 + b.m);
  }

  // Education start / end month and year.
  const date = l.match(/^(?:education\s+|school\s+)?(start|end|graduation|expected graduation|grad)\s*(?:date)?\s*[-:(]?\s*(month|year)?\)?$|^(month|year) of (graduation|enrollment)$|^(graduation|expected graduation) (date|month|year)$/);
  if (date) {
    const which = /start|enrollment/.test(l) ? "start" : "end";
    const part = /month/.test(l) ? "month" : /year/.test(l) ? "year" : "both";
    if (which === "start" && part === "both") return undefined; // a bare "Start date" asks when the applicant can start
    const ym = ymOf(which === "start" ? edu?.startDate : edu?.endDate);
    if (!ym) return null;
    if (part === "year") return yearOption(field, ym.y);
    if (part === "month") return ym.m ? monthOption(field, ym.m) : null;
    if (opts.length) return null;
    return ym.m ? `${MONTHS[ym.m - 1]} ${ym.y}` : String(ym.y);
  }
  return undefined;
}

/** What the agent composed for one free-text question, kept so the review UI can show provenance. */
export type ComposedAnswer = { answer: string; kind: QuestionKind; sources: string[]; usedLLM: boolean };

export type AnswerContext = {
  profile: ApplicantProfile;
  evidence: Evidence[];
  jobTitle: string;
  companyName: string;
  /** Job, research and baseline resume for the free-text composer. Defaults to what the fields above give. */
  compose?: { job: ComposeJob; research: CompanyResearch | null; baseline: ResumeContent; preferences?: Record<string, unknown> | null };
  /** Education nodes from the career graph, for start/end/graduation questions. */
  education?: EducationFact[];
  /** Sink for every composed answer, keyed by field label. */
  composed?: Record<string, ComposedAnswer>;
};

/** Fields the composer writes: free-text boxes that are textareas or whose label reads as an open question. */
export function shouldCompose(field: FormField, kind: QuestionKind = classifyQuestion(field.label, field)): boolean {
  if (!isFreeTextField(field)) return false;
  return field.kind === "textarea" || FREE_TEXT_KINDS.has(kind) || NEVER_COMPOSE.has(kind);
}

function composeInputFor(ctx: AnswerContext, field: FormField, kind: QuestionKind, jobContext: string): ComposeInput {
  const p = ctx.profile as ApplicantProfileFull;
  const c = ctx.compose;
  return {
    kind, label: field.label, field,
    job: c?.job ?? { title: ctx.jobTitle, companyName: ctx.companyName, descriptionText: jobContext, requirements: null },
    research: c?.research ?? null,
    evidence: ctx.evidence,
    profile: {
      fullName: p.fullName, preferences: c?.preferences ?? null, salaryExpectation: p.salaryExpectation, earliestStartDate: p.earliestStartDate,
      noticePeriodWeeks: p.noticePeriodWeeks, willingToRelocate: p.willingToRelocate, location: p.location, website: p.website, github: p.github,
      remotePreference: p.remotePreference,
    },
    baseline: c?.baseline ?? { name: p.fullName, contact: {}, experience: [], education: [], skills: [] },
  };
}

const SYSTEM = `You answer job application questions on behalf of the applicant, in the first person.
Use ONLY the facts provided (profile and career evidence). Never invent employers, numbers, skills, dates or credentials.
Write 2 to 4 sentences, plain text, no greeting, no sign-off. If the facts do not support an answer, reply with exactly UNKNOWN.
For a question with fixed options, reply with exactly one of the options.`;

/**
 * answerQuestion(field, jobContext) for DriverContext: profile heuristics first, then the free-text composer
 * for open questions (motivation, project stories, strengths...), then the LLM for anything else. Returns null
 * (the question goes to the user) only for legal identifiers, references, a missing portfolio link, and
 * questions nothing in the profile or graph can honestly answer.
 */
export function makeAnswerQuestion(ctx: AnswerContext) {
  return async (field: FormField, jobContext: string): Promise<string | null> => {
    // Education dates and term confirmations come from the graph and the job title, before the profile's own
    // start-date answer can claim "Start date month".
    if (field.kind !== "file") {
      const edu = educationAnswer(field, ctx.education ?? [], ctx.compose?.job.title ?? ctx.jobTitle);
      if (edu !== undefined) return edu;
    }
    const fromProfile = heuristicAnswer(field, ctx.profile);
    if (fromProfile !== null || field.kind === "file") return fromProfile;
    const kind = classifyQuestion(field.label, field);
    if (NEVER_COMPOSE.has(kind)) return null;
    if (shouldCompose(field, kind)) {
      const res = await composeAnswer(composeInputFor(ctx, field, kind, jobContext));
      if (res.answer) {
        if (ctx.composed) ctx.composed[field.label] = { answer: res.answer, kind, sources: res.sources, usedLLM: res.usedLLM };
        return res.answer;
      }
      // "" leaves an optional field blank; null on a known kind goes to the user. Unknown kinds still get the LLM's try.
      if (res.answer === "" || kind !== "unknown") return null;
    }
    const { value } = await withFallback<string | null>(
      async () => {
        const facts = ctx.evidence.slice(0, 12).map((e) => `- ${e.text}${e.companyLabel ? ` (${e.companyLabel})` : ""}`).join("\n");
        const prompt = [
          `Job: ${ctx.jobTitle} at ${ctx.companyName}`,
          jobContext ? `Job context: ${jobContext.slice(0, 1500)}` : "",
          `Applicant: ${ctx.profile.fullName || "(name unknown)"}${ctx.profile.location ? `, ${ctx.profile.location}` : ""}`,
          `Career evidence:\n${facts || "(none)"}`,
          `Question: ${field.label}`,
          field.options?.length ? `Options: ${field.options.join(" | ")}` : "",
        ].filter(Boolean).join("\n\n");
        const out = (await getLLM("quality").text({ system: SYSTEM, prompt, maxTokens: 400 })).trim();
        if (!out || /^unknown\.?$/i.test(out)) return null;
        if (field.options?.length) return field.options.find((o) => o.toLowerCase() === out.toLowerCase()) ?? null;
        // Free text the model wrote: every figure must already be in the facts it was given, or the question goes to the
        // person. It is recorded as a written answer so the review screen and Autopilot treat it as one.
        if (!numbersSupported(out, [facts, ctx.profile.fullName, ctx.profile.location ?? ""].join("\n"))) return null;
        if (ctx.composed) ctx.composed[field.label] = { answer: out, kind: "unknown", sources: [], usedLLM: true };
        return out;
      },
      () => null,
      "answerQuestion",
    );
    return value;
  };
}

/** True when every number in `text` (years, percentages, counts, money) also appears in `facts`. */
export function numbersSupported(text: string, facts: string): boolean {
  const norm = (n: string) => n.replace(/[,\s]/g, "");
  const known = new Set((facts.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm));
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) => known.has(norm(n)));
}

/** Questions most applications ask; answered up front so the user sees them at form review. */
export const LIKELY_QUESTIONS: FormField[] = [
  { label: "Are you legally authorized to work in the United States?", kind: "radio", required: true, options: ["Yes", "No"], selector: "" },
  { label: "Will you now or in the future require sponsorship for employment visa status?", kind: "radio", required: true, options: ["Yes", "No"], selector: "" },
  { label: "LinkedIn Profile", kind: "text", required: false, selector: "" },
  { label: "Website", kind: "text", required: false, selector: "" },
  { label: "Location", kind: "text", required: false, selector: "" },
  { label: "Why are you interested in this role?", kind: "textarea", required: false, selector: "" },
];
