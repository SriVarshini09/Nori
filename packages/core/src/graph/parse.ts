import { z } from "zod";
import { findSkills, canonicalSkill } from "./skills.js";
import { extractMetrics, normalizeDate, isPresent } from "./metrics.js";
import { extractContact, parseLocation, type ContactInfo } from "../resume/contact.js";
import { sectionOf, type Section } from "../resume/sections.js";
import type { ExtractedLink } from "../resume/extract-text.js";

const nstr = z.string().nullish();

export const ContactSchema = z.object({
  fullName: nstr, email: nstr, phone: nstr,
  city: nstr, state: nstr, country: nstr,
  linkedin: nstr, github: nstr, website: nstr,
  otherLinks: z.array(z.object({ kind: nstr, url: z.string(), label: nstr })).nullish(),
});

const MetricSchema = z.object({
  statement: z.string(),
  value: z.union([z.string(), z.number()]).nullish(),
  unit: nstr,
});
const BulletSchema = z.object({
  text: z.string(),
  metrics: z.array(MetricSchema).nullish(),
  skills: z.array(z.string()).nullish(),
  /** Original line, when the parser knows it. */
  quote: nstr,
});

/** Structure the LLM extracts from a resume; the heuristic parser produces the same shape. */
export const ResumeStructSchema = z.object({
  profile: z.object({
    fullName: nstr, email: nstr, phone: nstr, linkedin: nstr, location: nstr, website: nstr,
    github: nstr, city: nstr, state: nstr, country: nstr,
  }).nullish(),
  /** Contact block; URLs must come from the "Links found in the document" list or the text itself. */
  contact: ContactSchema.nullish(),
  roles: z.array(z.object({
    title: z.string(),
    company: nstr,
    location: nstr,
    /** Dates as written ("Jan 2022", "2022-01"); end is "Present" or null for a current role. */
    start: nstr,
    end: nstr,
    employmentType: nstr,
    bullets: z.array(BulletSchema).nullish(),
  })).nullish(),
  education: z.array(z.object({
    school: z.string(), degree: nstr, field: nstr, start: nstr, end: nstr,
  })).nullish(),
  skills: z.array(z.object({ name: z.string(), level: nstr })).nullish(),
  projects: z.array(z.object({
    name: z.string(),
    description: nstr,
    /** Company or title of the role this project belonged to, if any. */
    role: nstr,
    skills: z.array(z.string()).nullish(),
    bullets: z.array(z.string()).nullish(),
  })).nullish(),
  certifications: z.array(z.union([z.string(), z.object({ name: z.string(), issuer: nstr, date: nstr })])).nullish(),
});
export type ResumeStruct = z.infer<typeof ResumeStructSchema>;
type Role = NonNullable<ResumeStruct["roles"]>[number];
type Bullet = NonNullable<Role["bullets"]>[number];

// ---------- patterns ----------
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const DATE = `(?:${MONTH}[,\\s]+\\d{4}|${SEASON}\\s+\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4}[-/.](?:0[1-9]|1[0-2])(?!\\d)|(?:19|20)\\d{2})`;
const RANGE = new RegExp(`\\(?\\b(${DATE})\\s*(?:-|\\u2013|\\u2014|\\u2012|~|to|until|through|thru)\\s*(${DATE}|present|current|now|ongoing|today)\\b\\)?`, "i");
const BULLET = /^\s*(?:[•·●▪■◦‣▸►○∙]\s*|[-–—*]\s+)(.+?)\s*$/;
const TITLE_RE = /\b(engineer(?:ing)?|developer|programmer|manager|director|analyst|designer|scientist|lead|intern|internship|consultant|architect|specialist|associate|officer|president|vp|vice president|head|founder|co-founder|cto|ceo|coo|cfo|coordinator|representative|executive|administrator|technician|strategist|researcher|recruiter|accountant|owner|principal|staff|senior|junior|sr\.?|jr\.?|assistant|advisor|writer|editor|marketer|agent|trainee|apprentice|fellow|teacher|instructor|professor|sales|swe|sde|devops|sre|tester|qa|admin|partner|supervisor|clerk|generalist)\b/i;
const REMOTE_RE = /^(?:remote|hybrid|on-?site|in-?office)(?:\s*\(.*\))?$/i;
const isLocationPart = (p: string) => REMOTE_RE.test(p.trim()) || parseLocation(p) !== null;
const LOC_PART = { test: isLocationPart };
const LOC_SUFFIX_RE = /\s*,\s*([A-Z][A-Za-z.' ]+,\s*[A-Za-z][A-Za-z. ]+)$|\s*\((remote|hybrid|on-?site)\)$/i;
const LOC_SUFFIX = { exec: (p: string) => { const m = LOC_SUFFIX_RE.exec(p); return m && (m[2] || isLocationPart(m[1])) ? m : null; } };
const SEP_RE = /\s[|•·—–-]\s/;
const EMPLOYMENT_PART = /^\(?(?:intern(?:ship)?|contract(?:or)?|freelance|part[- ]time|full[- ]time|temporary|temp|apprentice(?:ship)?|seasonal|permanent|self[- ]employed)\)?$/i;
const COMPANY_HINT = /\b(?:inc|llc|ltd|limited|corp|corporation|company|gmbh|plc|pvt|labs?|technologies|group|holdings|bank|studios?|ventures|solutions|university|hospital|agency)\b\.?/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const stripEdges = (s: string) => s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/g, "");

// ---------- profile ----------
function profileFrom(c: ContactInfo): NonNullable<ResumeStruct["profile"]> {
  return {
    fullName: c.fullName, email: c.email, phone: c.phone, linkedin: c.linkedin, location: c.location, website: c.website,
    github: c.github, city: c.city, state: c.state, country: c.country,
  };
}

// ---------- experience ----------
type Header = { title: string; company: string; location?: string; start: string | null; end: string | null; employmentType: string };

function parseHeader(raw: string): Header {
  let s = raw;
  let start: string | null = null, end: string | null = null;
  const m = RANGE.exec(s);
  if (m) {
    start = normalizeDate(m[1], "start");
    end = isPresent(m[2]) ? null : normalizeDate(m[2], "end");
    s = s.replace(m[0], " | ");
  }
  const et = /\b(intern(?:ship)?|contract(?:or)?|freelance|part[- ]time|full[- ]time|temporary|apprentice)\b/i.exec(raw);
  const employmentType = et ? (/intern/i.test(et[1]) ? "internship" : et[1].toLowerCase().replace(/\s+/g, "-").replace("contractor", "contract")) : "full-time";

  let parts = s.split(/\s*[|•·]\s*|\s+[—–]\s+|\s+-\s+|\s{3,}/).map((p) => stripEdges(clean(p))).filter(Boolean);
  parts = parts.flatMap((p) => {
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(p);
    return at && TITLE_RE.test(at[1]) ? [at[1], at[2]] : [p];
  });
  if (parts.length === 1) {
    const c = parts[0].split(/\s*,\s*/);
    if (c.length >= 2 && TITLE_RE.test(c[0]) && !TITLE_RE.test(c[1])) parts = [c[0], c.slice(1).join(", ")];
  }

  let location: string | undefined;
  parts = parts.filter((p) => !EMPLOYMENT_PART.test(p)).filter((p) => {
    if (LOC_PART.test(p)) { location ??= p; return false; }
    return true;
  }).map((p) => {
    const ls = LOC_SUFFIX.exec(p);
    if (ls && p.length > ls[0].length) { location ??= clean(ls[1] ?? ls[2]); return p.slice(0, p.length - ls[0].length); }
    return p;
  });

  // Title = the part with the most title words; company hints ("Inc", "Labs") count against it.
  let ti = 0, best = -Infinity;
  const titleWords = new RegExp(TITLE_RE.source, "gi");
  parts.forEach((p, i) => {
    const words = p.match(titleWords)?.length ?? 0;
    const score = words * 2 - (COMPANY_HINT.test(p) ? 3 : 0) - i * 0.1;
    if (words > 0 && score > best) { best = score; ti = i; }
  });
  const title = parts[ti] ?? "";
  const company = parts.find((p, i) => i !== ti && !/^\d+$/.test(p)) ?? "";
  return { title: clean(title), company: clean(company), location, start, end, employmentType };
}

function looksLikeHeader(line: string): boolean {
  if (RANGE.test(line)) return true;
  if (line.length <= 90 && !/[.;]$/.test(line) && (SEP_RE.test(line) || (/\s(?:at|@)\s/.test(line) && TITLE_RE.test(line)))) return true;
  return line.length <= 60 && /^[A-Z]/.test(line) && TITLE_RE.test(line) && !/[.;,]$/.test(line);
}

function makeBullet(text: string, quote: string): Bullet {
  return { text, metrics: extractMetrics(text), skills: findSkills(text), quote };
}

function parseExperience(lines: string[]): Role[] {
  const roles: Role[] = [];
  let pending: string[] = [];
  let cur = null as Role | null;
  let last = null as Bullet | null;

  const flush = () => {
    if (!pending.length) return;
    const h = parseHeader(pending.join(" | "));
    pending = [];
    last = null;
    if (!h.title) return;
    cur = { title: h.title, company: h.company, location: h.location, start: h.start, end: h.end, employmentType: h.employmentType, bullets: [] };
    roles.push(cur);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) {
      if (pending.length) flush();
      if (!cur) continue;
      last = makeBullet(clean(b[1]), line);
      cur.bullets!.push(last);
      continue;
    }
    const hasRange = RANGE.test(line);
    if (cur && last && !pending.length && !looksLikeHeader(line)) {
      last.text = clean(`${last.text} ${line}`);
      last.metrics = extractMetrics(last.text);
      last.skills = findSkills(last.text);
      last.quote = `${last.quote ?? ""} ${line}`.trim();
      continue;
    }
    if (hasRange && pending.some((p) => RANGE.test(p))) flush();
    if (pending.length >= 3) flush();
    const longProse = line.length > 110 || line.split(/\s+/).length > 14;
    if (cur && !last && !pending.length && longProse) {
      last = makeBullet(clean(line), line);
      cur.bullets!.push(last);
      continue;
    }
    if (longProse && !hasRange) continue;
    pending.push(line);
  }
  flush();
  return roles;
}

// ---------- skills ----------
const LEVELS = /^(beginner|novice|intermediate|advanced|expert|proficient|familiar|fluent|basic|working knowledge)$/i;

function parseSkills(lines: string[]): NonNullable<ResumeStruct["skills"]> {
  const out: NonNullable<ResumeStruct["skills"]> = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) line = b[1];
    line = line.replace(/^[A-Za-z][A-Za-z &/+#.-]{1,35}:\s*/, (m) => (m.includes(",") ? m : ""));
    const prose = line.split(/\s+/).length > 12 && /[.]$/.test(line);
    if (prose) {
      for (const name of findSkills(line)) out.push({ name });
      continue;
    }
    for (const itemRaw of line.split(/\s*[,;|•·]\s*|\s{2,}|\s+\/\s+/)) {
      let item = clean(itemRaw);
      if (!item) continue;
      let level: string | undefined;
      const paren = /\(([^)]*)\)\s*$/.exec(item);
      if (paren) {
        if (LEVELS.test(paren[1].trim())) level = paren[1].trim().toLowerCase();
        item = clean(item.slice(0, paren.index));
      }
      item = item.replace(/[.:]+$/, "");
      if (!item) continue;
      const canon = canonicalSkill(item);
      if (canon) { out.push({ name: canon, level }); continue; }
      const found = findSkills(item);
      if (found.length) { for (const f of found) out.push({ name: f, level }); continue; }
      if (item.length <= 30 && item.split(" ").length <= 3 && !/\d{3,}/.test(item) && /[A-Za-z]/.test(item)) out.push({ name: item, level });
    }
  }
  return out;
}

// ---------- education ----------
const ABBR = /\b(?:B\.?S\.?c?|B\.?F\.?A|B\.?A|B\.?Eng|B\.?Tech|B\.?Com|B\.?Arch|B\.E|M\.?S\.?c?|M\.?F\.?A|M\.?A|M\.?Eng|M\.?Tech|M\.?Com|M\.?P\.?H|M\.?P\.?A|MBA|EMBA|Ph\.?D|Ed\.?D|J\.?D|LL\.?B|LL\.?M|BBA|BCA|MCA|M\.?Phil|A\.?A\.?S|A\.?S)\b\.?/;
const DEGREE_WORDS = /\b(?:(?:Bachelor|Master|Associate)(?:'s|s)?(?:\s+of\s+(?:Science|Arts|Engineering|Technology|Business Administration|Fine Arts))?|Doctor(?:ate)?(?:\s+of\s+Philosophy)?|Diploma)\b/i;
const SCHOOL_RE = /\b(university|college|institute|school|academy|polytechnic|universit[éy])\b/i;

function parseEducation(lines: string[]): NonNullable<ResumeStruct["education"]> {
  type E = NonNullable<ResumeStruct["education"]>[number];
  const out: E[] = [];
  let cur = null as E | null;
  const push = () => { if (cur && (cur.school || cur.degree)) out.push(cur); cur = null; };

  for (const raw of lines) {
    let line = raw.trim();
    if (!line || BULLET.test(line)) continue;
    let start: string | null = null, end: string | null = null;
    const r = RANGE.exec(line);
    if (r) {
      start = normalizeDate(r[1], "start");
      end = isPresent(r[2]) ? null : normalizeDate(r[2], "end");
      line = line.replace(r[0], " | ");
    } else {
      const single = new RegExp(`(?:expected|graduated|class of)?\\s*\\(?(${DATE})\\)?`, "i").exec(line);
      if (single && /\d{4}/.test(single[1])) { end = normalizeDate(single[1], "end"); line = line.replace(single[0], " | "); }
    }
    line = line.replace(/\bGPA\b.*$/i, "");
    const parts = line.split(/\s*[|•·]\s*|\s+[—–-]\s+|\s*,\s*/).map((p) => stripEdges(clean(p))).filter(Boolean);
    const schoolPart = parts.find((p) => SCHOOL_RE.test(p));
    const degPart = parts.find((p) => !SCHOOL_RE.test(p) && (ABBR.test(p) || DEGREE_WORDS.test(p)));
    if (!schoolPart && !degPart) continue;
    if (schoolPart && cur?.school) push();
    if (degPart && cur?.degree) push();
    cur ??= { school: "" };
    if (schoolPart && !cur.school) cur.school = schoolPart;
    if (degPart) {
      const tok = (DEGREE_WORDS.exec(degPart) ?? ABBR.exec(degPart))!;
      cur.degree = tok[0];
      let field = degPart.slice(tok.index + tok[0].length).replace(/^(?:\s|in|of|,|-|:)+/i, "").trim();
      if (!field) {
        const idx = parts.indexOf(degPart);
        const next = parts.slice(idx + 1).find((p) => !SCHOOL_RE.test(p) && !LOC_PART.test(p));
        if (next && !ABBR.test(next) && !DEGREE_WORDS.test(next)) field = next;
      }
      field = field.replace(/^\((?:hons?\.?|honou?rs)\)\s*,?\s*/i, "").replace(/\s*\((?:hons?\.?|honou?rs)\)\s*$/i, "").trim();
      if (field) cur.field = field;
    }
    if (start && !cur.start) cur.start = start;
    if (end && !cur.end) cur.end = end;
  }
  push();
  return out;
}

// ---------- projects / certifications ----------
function parseProjects(lines: string[]): NonNullable<ResumeStruct["projects"]> {
  type P = NonNullable<ResumeStruct["projects"]>[number];
  const out: P[] = [];
  let cur = null as P | null;
  const text = (p: P) => `${p.name} ${p.description ?? ""} ${(p.bullets ?? []).join(" ")}`;
  const finish = () => { if (cur) { cur.skills = findSkills(text(cur)); out.push(cur); } cur = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) {
      if (!cur) cur = { name: "Project", bullets: [] };
      cur.bullets!.push(clean(b[1]));
      continue;
    }
    const isHeader = line.length <= 110 && !/[.;]$/.test(line);
    if (cur && cur.bullets!.length && !isHeader) { cur.bullets![cur.bullets!.length - 1] += ` ${clean(line)}`; continue; }
    if (cur && !cur.bullets!.length && !cur.description && !isHeader) { cur.description = clean(line); continue; }
    finish();
    const parts = line.split(/\s*[|•·]\s*|\s+[—–-]\s+|:\s+/).map((p) => stripEdges(clean(p))).filter(Boolean);
    const name = (parts[0] ?? line).replace(/\(.*?\)\s*$/, "").trim();
    cur = { name, description: parts.slice(1).filter((p) => !/^\d{4}$/.test(p)).join(" | ") || null, bullets: [] };
  }
  finish();
  return out;
}

function parseCertifications(lines: string[]): NonNullable<ResumeStruct["certifications"]> {
  const out: NonNullable<ResumeStruct["certifications"]> = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) line = b[1];
    if (line.length > 140) continue;
    const d = new RegExp(`\\(?(${DATE})\\)?\\s*$`, "i").exec(line);
    const date = d ? normalizeDate(d[1], "end") : null;
    if (d) line = line.slice(0, d.index);
    line = stripEdges(clean(line));
    if (line) out.push(date ? { name: line, date } : line);
  }
  return out;
}

// ---------- entry point ----------
type Buckets = { experience: string[]; education: string[]; skills: string[]; projects: string[]; certifications: string[]; summary: string[]; other: string[] };
const BUCKET: Record<Section, keyof Buckets> = {
  experience: "experience", education: "education", skills: "skills", projects: "projects", certifications: "certifications",
  summary: "summary", contact: "other", publications: "other", awards: "other", languages: "other", volunteer: "other", other: "other",
};

/** Rule-based resume parser. `links` are the document's hyperlinks (PDF link annotations, DOCX hrefs). */
export function parseResumeHeuristic(text: string, links: ExtractedLink[] = []): ResumeStruct {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const buckets: Buckets = { experience: [], education: [], skills: [], projects: [], certifications: [], summary: [], other: [] };
  let current: keyof Buckets | null = null;
  for (const line of lines) {
    const sec = sectionOf(line);
    if (sec && !BULLET.test(line)) { current = BUCKET[sec]; continue; }
    if (current) buckets[current].push(line);
  }
  const contact = extractContact(text, links);
  const roles = parseExperience(buckets.experience);
  const skills = parseSkills(buckets.skills);
  const have = new Set(skills.map((s) => s.name.toLowerCase()));
  for (const r of roles) for (const b of r.bullets ?? []) for (const name of b.skills ?? []) {
    if (!have.has(name.toLowerCase())) { have.add(name.toLowerCase()); skills.push({ name }); }
  }
  return {
    profile: profileFrom(contact),
    contact: {
      fullName: contact.fullName, email: contact.email, phone: contact.phone, city: contact.city, state: contact.state,
      country: contact.country, linkedin: contact.linkedin, github: contact.github, website: contact.website, otherLinks: contact.otherLinks,
    },
    roles,
    education: parseEducation(buckets.education),
    skills,
    projects: parseProjects(buckets.projects),
    certifications: parseCertifications(buckets.certifications),
  };
}
