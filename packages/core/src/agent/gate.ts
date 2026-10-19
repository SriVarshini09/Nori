import type { Graph } from "../contracts.js";
import type { JobRequirements, Preferences, SalaryExpectation, WorkAuth } from "../db/schema.js";

/**
 * Hard disqualifiers checked before the agent spends a tailoring run on a job. Pure: no db, no LLM.
 * A job fails only on a clear conflict between what the posting states and what the profile says;
 * unknown profile fields never disqualify.
 */
export type GateJob = {
  companyName: string;
  title?: string;
  location?: string | null;
  remote?: boolean | null;
  descriptionText?: string | null;
};

export type GateProfile = {
  workAuth?: WorkAuth | Record<string, unknown> | null;
  securityClearance?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  remotePreference?: string | null;
  willingToRelocate?: boolean | null;
  preferences?: Preferences | null;
  salaryExpectation?: SalaryExpectation | null;
};

export type GateContext = {
  /** The career graph; role nodes' earliest startDate gives years of experience. */
  graph?: Pick<Graph, "nodes">;
  /** Or pass the earliest role start directly (ISO date or "YYYY-MM"). */
  earliestRoleStart?: string | null;
  now?: Date;
};

export type GateResult = { ok: boolean; reasons: string[] };

const CITIZEN_RE = /\b(?:u\.?s\.?|united states|american)\s+citizen(?:ship)?\b[^.\n]{0,60}\b(?:required|must|only|mandatory)\b|\b(?:must|required to|need to)\s+(?:be|hold)\s+(?:an?\s+)?(?:u\.?s\.?|united states)\s+citizen|\b(?:only|requires?)\s+(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\b|\bu\.?s\.?\s+citizenship\s+(?:is\s+)?required\b/i;
const CLEARANCE_RE = /\b(?:active|current|existing)\s+(?:(?:secret|top secret|ts\/sci|ts|public trust|dod|government)\s+)*(?:security\s+)?clearance\b|\b(?:security|secret|top secret|ts\/sci)\s+clearance\s+(?:is\s+)?(?:required|needed|mandatory)\b|\bmust\s+(?:have|hold|possess)\s+(?:an?\s+)?(?:active\s+)?(?:secret|top secret|ts\/sci|security)\s+clearance\b|\bts\/sci\b/i;
const OBTAIN_CLEARANCE_RE = /\b(?:able|ability|eligible|eligibility)\s+to\s+obtain\s+(?:and\s+maintain\s+)?(?:an?\s+)?(?:(?:secret|top secret|ts\/sci|security)\s+)*clearance\b/i;
const NO_SPONSOR_RE = /\b(?:no|not|unable to|cannot|can't|won't|will not|do not|does not|don't)\s+(?:provide\s+|offer\s+|support\s+)?(?:(?:work\s+)?visa\s+|h-?1b\s+|immigration\s+)?sponsor(?:ship)?\b|\bwithout\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+)?(?:visa\s+|employer\s+)?sponsorship\b|\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/i;
const ONSITE_RE = /\b(?:on-?site|in[- ]office|in person|office-based|5 days (?:a|per) week in (?:the )?office|not (?:a )?remote|no remote)\b/i;
const MUST_LOCATE_RE = /\b(?:must|need to|required to|should)\s+(?:be\s+)?(?:located|based|reside|residing|live|living)\s+(?:in|within|near)\s+(?:the\s+)?([^.;:()\n]+)/i;
const ONLY_OPEN_RE = /\bonly\s+(?:open|available)\s+to\s+(?:candidates|applicants)\s+(?:in|located in|based in)\s+(?:the\s+)?([^.;:()\n]+)/i;

/** Titles that mark a role for people starting out. */
const ENTRY_RE = /\b(intern(?:ship)?|new[- ]grad(?:uate)?|early[- ]career|entry[- ]level|apprentice(?:ship)?|co-?op|junior|jr\.?)(?=\W|$)/i;

const US_RE = /^(?:us|u\.s\.?|usa|u\.s\.a\.?|united states(?: of america)?|america)$/i;
const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware",
  DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
  MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
  PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};
const STATE_NAMES = new Set(Object.values(US_STATES));

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Lowercase place tokens for a location string: "San Francisco, CA" -> ["san francisco", "ca", "california", "us"]. */
function placeTokens(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[,/|;]|\s+-\s+|\(|\)/)) {
    const p = part.trim();
    if (!p) continue;
    const l = p.toLowerCase().replace(/\.$/, "");
    if (US_RE.test(l)) { out.add("us"); continue; }
    out.add(l);
    const st = US_STATES[p.toUpperCase()];
    if (st && p.length === 2) { out.add(st); out.add("us"); }
    if (STATE_NAMES.has(l)) out.add("us");
  }
  return out;
}

function profilePlaces(p: GateProfile): Set<string> {
  const out = new Set<string>();
  for (const s of [p.location, p.city, p.state, p.country]) for (const t of placeTokens(s)) out.add(t);
  return out;
}

/** True when the required place overlaps what we know of the user's location. */
function placeMatches(required: string, mine: Set<string>): boolean {
  const req = placeTokens(required.replace(/\s+(?:and|or)\s+(?:be|have|must|able)\b.*$/i, ""));
  if (!req.size) return true;
  // A country token only counts when the requirement names nothing more specific.
  const specific = [...req].filter((r) => r !== "us");
  if (!specific.length) return mine.has("us");
  for (const r of specific) {
    if (/\bremote\b/.test(r)) return true;
    if (mine.has(r)) return true;
    for (const m of mine) if (m.length > 3 && (r.includes(m) || m.includes(r))) return true;
  }
  return false;
}

/** Earliest role start among graph role nodes (YYYY-MM or YYYY-MM-DD). */
export function earliestRoleStart(graph: Pick<Graph, "nodes"> | undefined): string | null {
  let best: string | null = null;
  for (const n of graph?.nodes ?? []) {
    if (n.type !== "role" || !n.startDate) continue;
    if (!/^\d{4}/.test(n.startDate)) continue;
    if (!best || n.startDate < best) best = n.startDate;
  }
  return best;
}

export function yearsSince(start: string, now = new Date()): number {
  const [y, m] = start.split("-").map((x) => Number(x));
  const from = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return Math.max(0, (now.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000));
}

const NUM = String.raw`\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?`;
const RANGE_RE = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}`, "g");

/**
 * Annual salary range stated in a posting, in whole currency units. Handles "$120,000 - $150,000",
 * "120k–150k", "$120K to $150K". Hourly and monthly ranges, and numbers too small to be annual pay, are ignored.
 */
export function parseSalaryRange(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  for (const m of text.matchAll(RANGE_RE)) {
    const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 20).toLowerCase();
    if (/^\s*(?:\/|per\s+|an?\s+)(?:hr|hour|month|mo)\b/.test(tail)) continue;
    const head = text.slice(Math.max(0, m.index! - 3), m.index!);
    const hasDollar = m[0].includes("$") || /\$\s*$/.test(head) || /usd/i.test(text.slice(Math.max(0, m.index! - 8), m.index! + m[0].length + 8));
    const hasK = Boolean(m[2] || m[4]);
    if (!hasDollar && !hasK) continue;
    const val = (n: string, k: string | undefined, otherK: boolean) => {
      let v = Number(n.replace(/,/g, ""));
      if (k || (otherK && v < 1000)) v *= 1000;
      return v;
    };
    const lo = val(m[1], m[2], Boolean(m[4]));
    const hi = val(m[3], m[4], Boolean(m[2]));
    if (!(lo >= 20_000 && hi >= lo && hi <= 5_000_000)) continue;
    return { min: lo, max: hi };
  }
  return null;
}

function hasClearance(v: string | null | undefined): boolean {
  const s = lc(v);
  return Boolean(s) && !/^(?:none|no|n\/a|na|false|decline|-)$/.test(s);
}

function normCompany(s: string): string {
  return lc(s).replace(/[,.]/g, "").replace(/\s+(?:inc|llc|ltd|corp|corporation|co|gmbh|plc)$/, "").trim();
}

/** Check the posting against the profile. reasons are short, plain sentences for the timeline and chat. */
export function checkDisqualifiers(job: GateJob, requirements: JobRequirements | null | undefined, profile: GateProfile, ctx: GateContext = {}): GateResult {
  const reasons: string[] = [];
  const wa = (profile.workAuth ?? {}) as WorkAuth;
  const prefs = profile.preferences ?? {};
  const text = [job.descriptionText ?? "", ...(requirements?.mustHaves ?? []), ...(requirements?.disqualifiers ?? [])].join("\n");

  // Excluded companies.
  const company = normCompany(job.companyName);
  if ((prefs.excludeCompanies ?? []).some((c) => normCompany(c) && normCompany(c) === company)) {
    reasons.push(`${job.companyName} is on your excluded companies list`);
  }

  // Citizenship and clearance.
  if (CITIZEN_RE.test(text) && wa.status && wa.status !== "citizen") {
    reasons.push("Requires US citizenship");
  }
  if (CLEARANCE_RE.test(text) && !hasClearance(profile.securityClearance)) {
    reasons.push("Requires an active security clearance");
  } else if (OBTAIN_CLEARANCE_RE.test(text) && wa.status && wa.status !== "citizen" && !reasons.includes("Requires US citizenship")) {
    reasons.push("Requires eligibility for a US security clearance (usually citizenship)");
  }

  // Sponsorship.
  if (NO_SPONSOR_RE.test(text) && wa.needsSponsorship === true) {
    reasons.push("No visa sponsorship offered and you need it");
  }

  // Location.
  const mine = profilePlaces(profile);
  const relocate = profile.willingToRelocate === true;
  const wantsRemoteOnly = lc(profile.remotePreference) === "remote" || prefs.remote === "only";
  const locMatch = MUST_LOCATE_RE.exec(text) ?? ONLY_OPEN_RE.exec(text);
  const onsite = !job.remote && (ONSITE_RE.test(text) || /\b(?:on-?site|in office|hybrid)\b/i.test(job.location ?? ""));
  if (locMatch && mine.size && !relocate && !placeMatches(locMatch[1], mine)) {
    reasons.push(`Must be located in ${locMatch[1].trim().replace(/\s+(?:and|or)\s+.*$/i, "")}`);
  } else if (onsite) {
    if (wantsRemoteOnly) reasons.push(`On-site role${job.location ? ` in ${job.location}` : ""} and you want remote only`);
    else if (job.location && mine.size && !relocate && !placeMatches(job.location, mine)) {
      reasons.push(`On-site in ${job.location}, away from where you live`);
    }
  } else if (!job.remote && wantsRemoteOnly && job.location && !/\bremote\b/i.test(job.location) && /\b(?:hybrid)\b/i.test(text)) {
    reasons.push(`Hybrid role in ${job.location} and you want remote only`);
  }

  // Years of experience (one year of grace).
  const start = ctx.earliestRoleStart ?? earliestRoleStart(ctx.graph);

  // Roles for people starting out are not for someone with several years behind them.
  const entry = ENTRY_RE.exec(job.title ?? "")?.[1]?.toLowerCase() ?? (requirements?.seniority === "intern" ? "intern" : undefined);
  if (entry && start) {
    const years = yearsSince(start, ctx.now);
    if (years >= 3) reasons.push(`Entry-level role (${entry}); you have about ${Math.floor(years)} years of experience`);
  }

  if (requirements?.yearsMin != null && start) {
    const years = yearsSince(start, ctx.now);
    if (years + 1 < requirements.yearsMin) {
      reasons.push(`Asks for ${requirements.yearsMin}+ years of experience; you have about ${Math.floor(years)}`);
    }
  }

  // Salary below the floor.
  const floor = prefs.salaryMin ?? null;
  if (floor) {
    const range = parseSalaryRange(job.descriptionText);
    if (range && range.max < floor) {
      reasons.push(`Pays up to $${Math.round(range.max / 1000)}k, below your $${Math.round(floor / 1000)}k minimum`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
