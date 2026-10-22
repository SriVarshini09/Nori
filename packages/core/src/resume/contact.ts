/**
 * High-precision contact extraction from resume text plus the document's hyperlinks.
 * Every field carries a confidence (0..1) taken from the rule that produced it, so callers can let a
 * strong rule beat an LLM and an LLM beat a weak rule.
 */
import { sectionOf } from "./sections.js";
import type { ExtractedLink } from "./extract-text.js";

export type ContactField = "fullName" | "email" | "phone" | "location" | "city" | "state" | "country" | "linkedin" | "github" | "website";
export type OtherLink = { kind: string; url: string; label?: string };
export type ContactInfo = {
  fullName?: string;
  email?: string;
  phone?: string;
  /** "City, ST" / "City, Country" as written (zip and prefixes removed). */
  location?: string;
  city?: string;
  state?: string;
  /** Full English country name ("United States", "United Kingdom"). */
  country?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  otherLinks: OtherLink[];
  confidence: Partial<Record<ContactField, number>>;
};

// ------------------------------------------------------------------ geography
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const US_STATE_NAMES = new Set(Object.values(US_STATES).map((s) => s.toLowerCase()));
const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const AU_STATES = new Set(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]);

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States", "us": "United States", "u.s.": "United States", "u.s.a.": "United States", "u.s.a": "United States",
  "united states": "United States", "united states of america": "United States", "america": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "united kingdom": "United Kingdom", "england": "United Kingdom",
  "great britain": "United Kingdom", "britain": "United Kingdom", "scotland": "United Kingdom", "wales": "United Kingdom",
  "northern ireland": "United Kingdom", "uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates",
  "the netherlands": "Netherlands", "holland": "Netherlands", "south korea": "South Korea", "korea": "South Korea",
  "republic of korea": "South Korea", "czechia": "Czech Republic", "türkiye": "Turkey", "turkiye": "Turkey", "prc": "China",
};
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahrain", "Bangladesh",
  "Belarus", "Belgium", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Bulgaria", "Cambodia", "Cameroon", "Canada",
  "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador",
  "Egypt", "El Salvador", "Estonia", "Ethiopia", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala",
  "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica",
  "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Lithuania", "Luxembourg", "Malaysia", "Malta",
  "Mexico", "Moldova", "Mongolia", "Morocco", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Nigeria",
  "North Macedonia", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa",
  "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Uganda",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Zambia", "Zimbabwe",
];
const COUNTRY_BY_LOWER = new Map<string, string>([...COUNTRIES.map((c) => [c.toLowerCase(), c] as [string, string]), ...Object.entries(COUNTRY_ALIASES)]);

export function canonicalCountry(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  return COUNTRY_BY_LOWER.get(s.trim().toLowerCase().replace(/\s+/g, " "));
}

// ------------------------------------------------------------------ helpers
const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URLISH_RE = /\b(?:https?:\/\/|www\.)[^\s<>()|,;"'\]]+/gi;
const KNOWN_HOSTS = "linkedin\\.com|github\\.com|github\\.io|gitlab\\.com|bitbucket\\.org|behance\\.net|dribbble\\.com|medium\\.com|substack\\.com|twitter\\.com|x\\.com|stackoverflow\\.com|kaggle\\.com|leetcode\\.com|codepen\\.io|huggingface\\.co|scholar\\.google\\.com|orcid\\.org|wellfound\\.com|angel\\.co|youtube\\.com|instagram\\.com|npmjs\\.com";
const BARE_KNOWN_RE = new RegExp(`(?<![\\w.@/-])(?:[a-z0-9-]+\\.)*(?:${KNOWN_HOSTS})(?:\\/[^\\s<>()|,;"'\\]]*)?`, "gi");
const BARE_DOMAIN_RE = /(?<![\w.@/-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|app|ai|xyz|tech|site|page|design|codes|blog|info|us|uk|in|ca|so|sh|work|studio|online|digital|portfolio)(?:\/[^\s<>()|,;"'\]]*)?(?![\w@])/gi;
const PHONE_RE = /(?<![\w/@.])(?:\+[ \t]?|00)?\(?\d[\d \t().\-–]{6,}\d(?![\w/@])/g;
const TRAIL = /[.,;:!?)\]}>'"’”]+$/;

const SEP = /\s*[|•·●▪◦✉☎✆📍📞📧🔗]\s*|\s{3,}|\t|\s+[—–]\s+/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function cleanUrlText(raw: string): string {
  let u = raw.trim().replace(TRAIL, "");
  // Keep a closing paren that belongs to the URL (wikipedia-style).
  if ((u.match(/\(/g)?.length ?? 0) > (u.match(/\)/g)?.length ?? 0) && raw.trim().endsWith(")")) u += ")";
  return u;
}

/** https URL with a lowercase host, no "www.", no trailing slash; social profiles also lose query and fragment. */
export function normalizeUrl(raw: string): string | null {
  let s = cleanUrlText(raw);
  if (!s || /^(?:mailto|tel|sms|javascript|data|file):/i.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(?:^|\.)linkedin\.com$/.test(host)) host = "linkedin.com";
  if (/^(?:m|mobile)\.twitter\.com$/.test(host)) host = "twitter.com";
  const social = /(?:^|\.)(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|twitter\.com|x\.com|behance\.net|dribbble\.com|kaggle\.com|leetcode\.com|stackoverflow\.com)$/.test(host);
  const path = u.pathname.replace(/\/+$/, "");
  const tail = social ? "" : `${u.search}${u.hash}`;
  return `https://${host}${path}${tail}`;
}

const GITHUB_RESERVED = new Set(["features", "about", "topics", "sponsors", "orgs", "marketplace", "pricing", "login", "join", "settings", "explore", "collections", "trending", "enterprise", "team", "customer-stories", "readme"]);

export function classifyUrl(url: string): { kind: string; profile?: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { kind: "website" }; }
  const host = u.hostname.replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "linkedin.com") {
    if ((segs[0] === "in" || segs[0] === "pub") && segs[1]) return { kind: "linkedin", profile: `https://linkedin.com/${segs[0]}/${segs[0] === "in" ? segs[1] : segs.slice(1).join("/")}` };
    return { kind: "linkedin-page" };
  }
  if (host === "github.com") {
    if (!segs[0] || GITHUB_RESERVED.has(segs[0].toLowerCase())) return { kind: "github-page" };
    const profile = `https://github.com/${segs[0]}`;
    return segs.length === 1 ? { kind: "github", profile } : { kind: "github-repo", profile };
  }
  if (host === "gist.github.com") return { kind: "gist" };
  if (host.endsWith(".github.io")) return { kind: "website" };
  const map: [RegExp, string][] = [
    [/(?:^|\.)gitlab\.com$/, "gitlab"], [/(?:^|\.)bitbucket\.org$/, "bitbucket"], [/(?:^|\.)behance\.net$/, "behance"],
    [/(?:^|\.)dribbble\.com$/, "dribbble"], [/(?:^|\.)medium\.com$/, "medium"], [/(?:^|\.)substack\.com$/, "substack"],
    [/^(?:twitter\.com|x\.com)$/, "twitter"], [/(?:^|\.)stackoverflow\.com$/, "stackoverflow"], [/(?:^|\.)kaggle\.com$/, "kaggle"],
    [/(?:^|\.)leetcode\.com$/, "leetcode"], [/(?:^|\.)codepen\.io$/, "codepen"], [/(?:^|\.)huggingface\.co$/, "huggingface"],
    [/^scholar\.google\./, "scholar"], [/(?:^|\.)orcid\.org$/, "orcid"], [/^(?:wellfound\.com|angel\.co)$/, "wellfound"],
    [/(?:^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/(?:^|\.)instagram\.com$/, "instagram"], [/(?:^|\.)npmjs\.com$/, "npm"],
    [/(?:^|\.)facebook\.com$/, "facebook"],
  ];
  for (const [re, kind] of map) if (re.test(host)) return { kind };
  return { kind: "website" };
}

/** Lines before the first content section, plus any "Contact" / "Links" section (sidebars). */
function headRegion(lines: string[]): { head: string[]; headSet: Set<number> } {
  const headSet = new Set<number>();
  let inHead = true, inContact = false, sawHeading = false;
  lines.forEach((l, i) => {
    const sec = sectionOf(l);
    if (sec) {
      sawHeading = true;
      inHead = false;
      inContact = sec === "contact";
      return;
    }
    if (inHead || inContact) headSet.add(i);
  });
  if (!sawHeading) {
    headSet.clear();
    let n = 0;
    lines.forEach((l, i) => { if (l.trim() && n++ < 12) headSet.add(i); });
  }
  // A heading-less resume whose first heading comes very late: cap the head at the first 15 non-empty lines.
  const capped = new Set<number>();
  let n = 0;
  for (const i of [...headSet].sort((a, b) => a - b)) {
    if (!lines[i].trim()) continue;
    if (n++ >= 15 && i > 25) continue;
    capped.add(i);
  }
  return { head: [...capped].sort((a, b) => a - b).map((i) => lines[i]), headSet: capped };
}

// ------------------------------------------------------------------ name
const CREDENTIALS = "PMP|MBA|Ph\\.?\\s?D\\.?|CPA|CFA|P\\.?E\\.?|RN|BSN|MSN|M\\.?D\\.?|D\\.?O\\.?|DDS|CISSP|CISM|CISA|CSM|CSPO|PHR|SPHR|SHRM-CP|SHRM-SCP|M\\.?S\\.?c?|B\\.?S\\.?c?|M\\.?A\\.?|B\\.?A\\.?|J\\.?D\\.?|Esq\\.?|CAPM|ACCA|ACA|CA|CEng|FRM|LEED\\s+AP|PA-C|NP|CPHQ|CCNA|CCNP|AWS|Jr\\.?|Sr\\.?|II|III|IV";
const CRED_SUFFIX = new RegExp(`(?:\\s*,\\s*|\\s+)(?:${CREDENTIALS})(?:\\s*,\\s*(?:${CREDENTIALS}))*\\.?$`, "i");
const PARTICLES = new Set(["van", "von", "de", "der", "den", "da", "das", "dos", "del", "della", "di", "du", "le", "la", "bin", "binti", "al", "el", "ter", "ten", "y"]);
const NOT_NAME = /\b(?:resume|résumé|curriculum|vitae|cv|portfolio|engineer|developer|manager|designer|analyst|scientist|consultant|specialist|director|architect|officer|intern|lead|president|founder|coordinator|administrator|associate|summary|profile|objective|experience|education|skills|contact|street|avenue|road|suite|apt|university|college|inc|llc|ltd|corp|technologies|solutions)\b/i;
const NAME_TOKEN = /^(?:\p{Lu}[\p{L}'’]*(?:-\p{Lu}?[\p{L}'’]+)*\.?|\p{Lu}\.)$/u;

function titleCaseName(s: string): string {
  const words = s.split(" ");
  if (!words.some((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}{2}/u.test(w))) return s;
  return words.map((w) => {
    if (/^\p{Lu}\.?$/u.test(w)) return w;
    return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  }).join(" ");
}

function nameCandidate(segment: string): string | null {
  let t = clean(segment).replace(/^#+\s*/, "").replace(/\*\*|__/g, "").replace(/^(?:name\s*:\s*)/i, "");
  t = t.replace(CRED_SUFFIX, "").replace(CRED_SUFFIX, "").replace(/[,;:]+$/, "").trim();
  if (!t || t.includes("@") || /\d/.test(t) || /https?:|www\.|\.com\b/i.test(t) || sectionOf(t) || NOT_NAME.test(t)) return null;
  const tokens = t.split(" ");
  const core = tokens.filter((w) => !PARTICLES.has(w.toLowerCase()));
  if (core.length < 2 || core.length > 4 || tokens.length > 5) return null;
  if (!tokens.every((w) => PARTICLES.has(w.toLowerCase()) || NAME_TOKEN.test(w))) return null;
  if (core.filter((w) => w.replace(/\./g, "").length > 1).length < 2) return null;
  return titleCaseName(t);
}

function findName(lines: string[], email?: string): { value: string; conf: number } | null {
  const top = lines.map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const local = (email ?? "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const boost = (name: string, base: number) => {
    const parts = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).map((p) => p.replace(/[^a-z]/g, "")).filter((p) => p.length > 1);
    return local && parts.some((p) => local.includes(p)) ? Math.min(0.98, base + 0.05) : base;
  };
  for (let i = 0; i < top.length; i++) {
    const sec = sectionOf(top[i]);
    if (sec === "contact") continue;
    if (sec) break;
    const segs = top[i].split(SEP).filter((s) => s.trim());
    const cand = segs.length ? nameCandidate(segs[0]) : null;
    if (cand) return { value: cand, conf: boost(cand, i < 3 ? 0.92 : 0.8) };
  }
  // Fallback: longest mostly-capitalized line in the first five lines.
  let best: string | null = null;
  for (const l of top.slice(0, 5)) {
    const seg = clean(l.split(SEP)[0] ?? "").replace(CRED_SUFFIX, "");
    if (!seg || /[@\d,]|https?:|www\./i.test(seg) || sectionOf(seg) || parseLocation(seg)) continue;
    const words = seg.split(" ");
    if (words.length < 2 || words.length > 5) continue;
    if (words.filter((w) => /^\p{Lu}/u.test(w)).length < words.length - 1) continue;
    if (!best || seg.length > best.length) best = seg;
  }
  return best ? { value: titleCaseName(best), conf: boost(best, 0.55) } : null;
}

// ------------------------------------------------------------------ phone
function validPhone(c: string): boolean {
  const digits = c.replace(/\D/g, "");
  const plus = /^\s*(?:\+|00)/.test(c);
  if (/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(c.trim())) return false;
  if (/\d{1,2}\/\d{2,4}/.test(c)) return false;
  if (/\s{3,}/.test(c)) return false;
  if ((c.match(/\(/g)?.length ?? 0) !== (c.match(/\)/g)?.length ?? 0) && !/^\(/.test(c.trim())) return false;
  if (plus) return digits.length >= 8 && digits.length <= 15;
  if (digits.startsWith("0")) return digits.length >= 10 && digits.length <= 12;
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function phonesIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(PHONE_RE)) {
    let c = m[0].trim().replace(/[\s–-]+$/, "");
    if (validPhone(c)) { out.push(clean(c)); continue; }
    // "WA 98101 (206) 555-0100": try suffixes starting at a group boundary.
    const starts = [...c.matchAll(/[\s(]\(?(?=\d|\+)/g)].map((x) => x.index! + (x[0].startsWith("(") ? 0 : 1));
    for (const s of starts) {
      const sub = c.slice(s).trim();
      if (validPhone(sub)) { out.push(clean(sub)); break; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ location
const LOC_PREFIX = /^(?:location|address|based\s+in|lives?\s+in|home|city|residence)\s*[:\-–]?\s*/i;
const CITY_RE = /^\p{Lu}[\p{L}.'’-]*(?:\s+(?:\p{Lu}[\p{L}.'’-]*|de|del|la|le|upon|on|am|sur|of))*$/u;

type Loc = { location: string; city: string; state?: string; country?: string; conf: number };

/** Parse "City, ST", "City, State", "City, Country", "City, Region, Country" (postcodes and "Location:" prefixes tolerated). */
export function parseLocation(fragRaw: string): Loc | null {
  let f = clean(fragRaw).replace(LOC_PREFIX, "").replace(/[.;]+$/, "");
  if (!f || f.length > 70 || /@|https?:|www\./i.test(f)) return null;
  // Drop a trailing postcode: US zip, UK postcode, Canadian postal code, generic digits.
  f = f.replace(/\s+\d{5}(?:-\d{4})?(?=$|,)/, "")
    .replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}(?=$|,)/, "")
    .replace(/\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d(?=$|,)/, "")
    .replace(/\s+\d{6}(?=$|,)/, "");
  const parts = f.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  // Street addresses: keep the trailing city/region/country.
  const tail = parts.length > 3 || /\d/.test(parts[0]) ? parts.slice(-3).filter((p) => !/\d/.test(p)) : parts;
  const tryParts = (ps: string[]): Loc | null => {
    if (ps.length < 2 || ps.length > 3) return null;
    const [city, a, b] = ps;
    if (!CITY_RE.test(city) || city.split(" ").length > 4) return null;
    const loc = ps.join(", ");
    if (ps.length === 3) {
      const country = canonicalCountry(b);
      if (country === "United States" && (US_STATES[a.toUpperCase()] && a === a.toUpperCase() || US_STATE_NAMES.has(a.toLowerCase())))
        return { location: `${city}, ${a}`, city, state: a, country, conf: 0.97 };
      if (country && /^\p{Lu}[\p{L} .'-]*$/u.test(a)) return { location: loc, city, state: a, country, conf: 0.93 };
      return null;
    }
    if (/^[A-Z]{2}$/.test(a) && US_STATES[a]) return { location: loc, city, state: a, country: "United States", conf: 0.95 };
    if (CA_PROVINCES.has(a)) return { location: loc, city, state: a, country: "Canada", conf: 0.9 };
    if (AU_STATES.has(a)) return { location: loc, city, state: a, country: "Australia", conf: 0.88 };
    if (US_STATE_NAMES.has(a.toLowerCase())) return { location: loc, city, state: a, country: "United States", conf: 0.93 };
    const country = canonicalCountry(a);
    if (country) return { location: loc, city, country, conf: 0.92 };
    return null;
  };
  return tryParts(tail);
}

function stripContactNoise(line: string): string {
  return line.replace(EMAIL_RE, " | ").replace(URLISH_RE, " | ").replace(BARE_KNOWN_RE, " | ").replace(PHONE_RE, (m) => (validPhone(m.trim()) ? " | " : m));
}

function findLocation(head: string[], fallback: string[]): Loc | null {
  const scan = (lines: string[], penalty: number): Loc | null => {
    for (const l of lines) {
      if (sectionOf(l)) continue;
      const stripped = stripContactNoise(l);
      for (const frag of stripped.split(SEP)) {
        const loc = parseLocation(frag);
        if (loc) return { ...loc, conf: Math.max(0.5, loc.conf - penalty) };
      }
      // "Alex Chen, San Francisco, CA" or "... San Francisco, CA 94105" inside a longer fragment.
      const m = /(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3}),\s*([A-Z]{2})\b(?!\.)/u.exec(stripped);
      if (m && US_STATES[m[2]]) return { location: `${m[1]}, ${m[2]}`, city: m[1], state: m[2], country: "United States", conf: Math.max(0.5, 0.8 - penalty) };
    }
    return null;
  };
  return scan(head, 0) ?? scan(fallback, 0.2);
}

// ------------------------------------------------------------------ links
type Cand = { url: string; kind: string; profile?: string; conf: number; anchor?: string; inHead: boolean; order: number };

const LABELED = /\b(linkedin|github|gitlab|twitter|behance|dribbble|medium|kaggle|leetcode)\s*(?::|-|–|—)\s*(?:@)?((?:in\/)?[A-Za-z0-9][A-Za-z0-9_.-]{1,60})\b/gi;
const LABEL_URL: Record<string, (h: string) => string> = {
  linkedin: (h) => `https://linkedin.com/in/${h.replace(/^in\//i, "")}`,
  github: (h) => `https://github.com/${h}`, gitlab: (h) => `https://gitlab.com/${h}`, twitter: (h) => `https://x.com/${h}`,
  behance: (h) => `https://behance.net/${h}`, dribbble: (h) => `https://dribbble.com/${h}`, medium: (h) => `https://medium.com/@${h}`,
  kaggle: (h) => `https://kaggle.com/${h}`, leetcode: (h) => `https://leetcode.com/${h}`,
};
const WEBSITE_ANCHOR = /portfolio|website|personal|home\s*page|homepage|blog|site|web|www|\.\w{2,}/i;

function collectLinks(text: string, lines: string[], headSet: Set<number>, links: ExtractedLink[]): { cands: Cand[]; emails: string[]; phones: string[] } {
  const cands: Cand[] = [];
  const emails: string[] = [];
  const phones: string[] = [];
  const headText = [...headSet].map((i) => lines[i]).join("\n");
  let order = 0;
  for (const l of links) {
    const raw = l.url.trim();
    if (/^mailto:/i.test(raw)) { const e = decodeURIComponent(raw.slice(7).split("?")[0]).trim(); if (e) emails.push(e); continue; }
    if (/^tel:/i.test(raw)) {
      const a = l.anchor && /\d{3}/.test(l.anchor) ? l.anchor : decodeURIComponent(raw.slice(4));
      phones.push(clean(a));
      continue;
    }
    const url = normalizeUrl(raw);
    if (!url) continue;
    const c = classifyUrl(url);
    const anchor = l.anchor?.trim();
    const inHead = !anchor || headText.includes(anchor) || WEBSITE_ANCHOR.test(anchor) || /linkedin|github/i.test(anchor);
    cands.push({ url, kind: c.kind, profile: c.profile, conf: 1, anchor, inHead, order: order++ });
  }
  lines.forEach((line, i) => {
    const inHead = headSet.has(i);
    const seen = new Set<string>();
    const add = (raw: string, conf: number) => {
      const url = normalizeUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const c = classifyUrl(url);
      cands.push({ url, kind: c.kind, profile: c.profile, conf, inHead, order: order++ });
    };
    const noEmail = line.replace(EMAIL_RE, " ");
    for (const m of noEmail.matchAll(URLISH_RE)) add(m[0], /^https?:/i.test(m[0]) ? 0.95 : 0.92);
    const noUrls = noEmail.replace(URLISH_RE, " ");
    for (const m of noUrls.matchAll(BARE_KNOWN_RE)) add(m[0], 0.9);
    if (inHead) for (const m of noUrls.replace(BARE_KNOWN_RE, " ").matchAll(BARE_DOMAIN_RE)) add(m[0], 0.88);
    for (const m of noUrls.matchAll(LABELED)) {
      const kind = m[1].toLowerCase();
      if (/\.(?:com|net|org|io)\b/i.test(m[2])) continue;
      add(LABEL_URL[kind](m[2]), 0.85);
    }
  });
  return { cands, emails, phones };
}

// ------------------------------------------------------------------ entry point

/**
 * The contact regexes rescan a long unbroken run from every start position, so their cost grows with the square of the run.
 * One very long "word" (or a long run of digits and spaces) in a pasted or uploaded resume froze the whole server for good.
 * Contact details sit in the header and are short, so cap the text and blank out any run no email, URL or phone could be.
 */
export const MAX_CONTACT_CHARS = 60_000;
export function boundContactText(text: string): string {
  return text.slice(0, MAX_CONTACT_CHARS).replace(/\S{200,}/g, " ").replace(/[\d \t().\-–]{40,}/g, " ");
}

export function extractContact(textRaw: string, links: ExtractedLink[] = []): ContactInfo {
  const text = boundContactText(textRaw.replace(/\r\n?/g, "\n"));
  const lines = text.split("\n");
  const { head, headSet } = headRegion(lines);
  const out: ContactInfo = { otherLinks: [], confidence: {} };
  const set = <K extends ContactField>(k: K, v: string | undefined, conf: number) => {
    if (!v) return;
    (out as Record<string, unknown>)[k] = v;
    out.confidence[k] = Math.round(conf * 100) / 100;
  };

  const { cands, emails: linkEmails, phones: linkPhones } = collectLinks(text, lines, headSet, links);

  // email
  const headEmail = head.join("\n").match(EMAIL_RE)?.[0];
  const anyEmail = text.match(EMAIL_RE)?.[0];
  if (linkEmails[0] && (!headEmail || headEmail.toLowerCase() === linkEmails[0].toLowerCase() || !anyEmail)) set("email", linkEmails[0], 1);
  else if (headEmail) set("email", headEmail, 0.98);
  else if (linkEmails[0]) set("email", linkEmails[0], 0.97);
  else if (anyEmail) set("email", anyEmail, 0.85);

  // phone
  const headPhone = head.flatMap(phonesIn)[0];
  if (headPhone) set("phone", headPhone, linkPhones.length ? 1 : 0.95);
  else if (linkPhones[0]) set("phone", linkPhones[0], 0.97);
  else {
    const top = lines.slice(0, 20).flatMap(phonesIn)[0] ?? lines.flatMap(phonesIn)[0];
    if (top) set("phone", top, 0.7);
  }

  // name
  const name = findName(lines, out.email);
  if (name) set("fullName", name.value, name.conf);

  // location
  const loc = findLocation(head, lines.filter((l) => l.trim()).slice(0, 15));
  if (loc) {
    set("location", loc.location, loc.conf);
    set("city", loc.city, loc.conf);
    set("state", loc.state, loc.conf);
    set("country", loc.country, loc.conf);
  }

  // links: annotations first (conf 1), then text by confidence and document order.
  const ranked = [...cands].sort((a, b) => b.conf - a.conf || a.order - b.order);
  const li = ranked.find((c) => c.kind === "linkedin");
  if (li) set("linkedin", li.profile ?? li.url, li.conf);
  const gh = ranked.find((c) => c.kind === "github");
  const ghRepo = ranked.find((c) => c.kind === "github-repo");
  if (gh) set("github", gh.profile ?? gh.url, gh.conf);
  else if (ghRepo?.profile) set("github", ghRepo.profile, Math.min(0.7, ghRepo.conf));
  const emailDomain = out.email?.split("@")[1]?.toLowerCase();
  const site = ranked.find((c) => c.kind === "website" && c.inHead && !(c.conf < 1 && emailDomain && new URL(c.url).hostname === emailDomain && /^(?:gmail|yahoo|outlook|hotmail|icloud|proton)/.test(emailDomain)));
  if (site) set("website", site.url, site.conf === 1 ? 0.97 : site.conf >= 0.92 ? 0.92 : 0.9);

  const used = new Set([out.linkedin, out.github, out.website].filter(Boolean) as string[]);
  const seen = new Set<string>();
  for (const c of [...cands].sort((a, b) => a.order - b.order)) {
    if (used.has(c.url) || (c.profile && used.has(c.profile)) || seen.has(c.url)) continue;
    if (c.kind === "github-repo" || c.kind === "github-page" || c.kind === "linkedin-page" || c.kind === "linkedin" || c.kind === "github") continue;
    if (c.kind === "website" && !c.inHead) continue;
    seen.add(c.url);
    out.otherLinks.push(c.anchor && c.anchor !== c.url ? { kind: c.kind, url: c.url, label: c.anchor } : { kind: c.kind, url: c.url });
  }
  return out;
}
