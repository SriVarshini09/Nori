import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { profiles } from "../db/schema.js";
import type { IngestResult } from "../contracts.js";
import { getLLM, withFallback } from "../llm/index.js";
import { getProfile } from "../users.js";
import { findSkills, normalizeSkill } from "./skills.js";
import { extractMetrics, extractQuantity, isPresent, normalizeDate } from "./metrics.js";
import { parseResumeHeuristic, ResumeStructSchema, type ResumeStruct } from "./parse.js";
import { GraphWriter } from "./store.js";
import { extractContact, normalizeUrl, classifyUrl, canonicalCountry, type ContactInfo } from "../resume/contact.js";
import type { ExtractedLink } from "../resume/extract-text.js";

const PROFILE_KEYS = ["fullName", "email", "phone", "linkedin", "location", "website", "github", "city", "state", "country"] as const;
export type ProfilePatch = Partial<Record<(typeof PROFILE_KEYS)[number], string>>;
export type IngestOptions = { source?: string; links?: ExtractedLink[] };
export type ResumeIngestResult = IngestResult & { profilePatch: ProfilePatch; contact: ContactInfo };

const SYSTEM = `You extract structured career data from resume text.
Rules:
- Copy text verbatim from the resume. Never invent employers, titles, dates, skills or numbers.
- roles: every job, newest first as written. Dates exactly as written ("Jan 2022"); use "Present" for a current job.
- bullets: one entry per achievement/responsibility line, text verbatim (without the bullet character). metrics lists the numbers the bullet states (statement, value like "30" or "2M", unit like "%", "$", "users"). skills lists technologies and skills the bullet mentions.
- skills: the resume's skills section items, with level only if the resume states one.
- projects, education, certifications: only what the resume lists. Leave unknown fields null.
- contact: fullName (without credentials like "PMP" or "PhD"), email, phone as written, city / state / country of the candidate's home location (country as a full English name), linkedin, github, website (personal site or portfolio), otherLinks (kind like "gitlab", "behance", "medium", "twitter"). URLs must be copied from "Links found in the document" or from the resume text; never construct or guess a URL. Leave a field null when the resume does not state it.`;

function linksBlock(links: ExtractedLink[]): string {
  const web = links.filter((l) => !/^(?:mailto|tel):/i.test(l.url));
  if (!web.length) return "Links found in the document: none (use only URLs written in the text).";
  return `Links found in the document (hyperlink target, then the words it sits behind):\n${web.map((l) => `- ${l.url}${l.anchor ? ` <- "${l.anchor}"` : ""}`).join("\n")}`;
}

async function llmParse(text: string, links: ExtractedLink[]): Promise<ResumeStruct> {
  return getLLM("bulk").json({
    name: "extract_resume",
    system: SYSTEM,
    prompt: `${linksBlock(links)}\n\nResume text:\n\n${text.slice(0, 40000)}`,
    schema: ResumeStructSchema,
    maxTokens: 16000,
  });
}

const str = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/**
 * Parse resume text (LLM when configured, heuristics otherwise), write it into the career graph and
 * patch empty profile fields. Safe to re-run: existing nodes are matched on (type, lowercased label).
 */
export async function ingestResume(db: Db, userId: string, text: string, opts: string | IngestOptions = "resume"): Promise<ResumeIngestResult> {
  const { source = "resume", links = [] } = typeof opts === "string" ? { source: opts } : opts;
  const { value: parsed, usedLLM } = await withFallback(() => llmParse(text, links), () => parseResumeHeuristic(text, links), "ingestResume", "bulk");
  const ruleContact = extractContact(text, links);
  const contact = usedLLM ? mergeContact(ruleContact, parsed.contact ?? parsed.profile, text, links) : ruleContact;
  const w = await GraphWriter.open(db, userId);

  const roleNodes: { id: string; title: string; company: string }[] = [];
  const firstRoleId = { id: undefined as string | undefined };

  // ----- roles -----
  for (const r of parsed.roles ?? []) {
    const title = str(r.title);
    if (!title) continue;
    const company = str(r.company);
    const start = normalizeDate(r.start, "start");
    const end = isPresent(r.end) ? null : normalizeDate(r.end, "end");
    const label = company ? `${title} at ${company}` : title;
    const employmentType = str(r.employmentType) || "full-time";

    const roleProps = { title, company, employmentType, location: str(r.location) || undefined, current: end === null && start !== null };
    const role = await w.node({ type: "role", label, props: roleProps, startDate: start, endDate: end, source });
    if (!role.created) await w.fillProps(role.id, roleProps, { startDate: start, endDate: end });
    roleNodes.push({ id: role.id, title, company });
    firstRoleId.id ??= role.id;

    if (company) {
      const co = await w.node({ type: "company", label: company, props: { kind: "employer" }, source });
      await w.edge(role.id, co.id, "worked_at");
    }

    const roleSkills: string[] = findSkills(title);
    let order = 0;
    for (const b of r.bullets ?? []) {
      const textB = str(b.text);
      if (!textB) continue;
      const metric = await addMetricNode(w, role.id, b, textB, order++, source);
      roleSkills.push(...metric.skills);
    }
    for (const s of uniq(roleSkills)) {
      const sk = await w.node({ type: "skill", label: s, source });
      await w.edge(role.id, sk.id, "used");
    }
  }

  // ----- skills section -----
  for (const s of parsed.skills ?? []) {
    const name = normalizeSkill(str(s.name));
    if (!name) continue;
    const level = str(s.level) || undefined;
    const sk = await w.node({ type: "skill", label: name, props: level ? { level } : {}, source });
    if (!sk.created && level) await w.fillProps(sk.id, { level });
  }

  // ----- education -----
  let firstEducationId: string | undefined;
  for (const e of parsed.education ?? []) {
    const school = str(e.school);
    const degree = str(e.degree);
    const field = str(e.field);
    if (!school && !degree) continue;
    const degreeText = [degree, field].filter(Boolean).join(" in ");
    const label = [degreeText, school].filter(Boolean).join(", ");
    const start = normalizeDate(e.start, "start");
    const end = isPresent(e.end) ? null : normalizeDate(e.end, "end");
    const props = { school, degree: degree || undefined, field: field || undefined };
    const edu = await w.node({ type: "education", label, props, startDate: start, endDate: end, source });
    if (!edu.created) await w.fillProps(edu.id, props, { startDate: start, endDate: end });
    firstEducationId ??= edu.id;
    if (school) {
      const inst = await w.node({ type: "company", label: school, props: { kind: "institution" }, source });
      await w.edge(edu.id, inst.id, "studied_at");
    }
  }

  // ----- certifications -----
  for (const c of parsed.certifications ?? []) {
    const name = str(typeof c === "string" ? c : c.name);
    if (!name) continue;
    const issuer = typeof c === "string" ? "" : str(c.issuer);
    const date = typeof c === "string" ? null : normalizeDate(c.date, "end");
    const cert = await w.node({ type: "certification", label: name, props: { issuer: issuer || undefined, date: date ?? undefined }, endDate: date, source });
    const holder = firstRoleId.id ?? firstEducationId;
    if (holder) await w.edge(holder, cert.id, "earned");
  }

  // ----- projects -----
  for (const p of parsed.projects ?? []) {
    const name = str(p.name);
    if (!name) continue;
    const bullets = (p.bullets ?? []).map(str).filter(Boolean);
    const skills = uniq([...(p.skills ?? []).map((s) => normalizeSkill(str(s))), ...findSkills(`${name} ${p.description ?? ""} ${bullets.join(" ")}`)].filter(Boolean));
    const props = { description: str(p.description) || undefined, skills };
    const proj = await w.node({ type: "project", label: name, props, source });
    if (!proj.created) await w.fillProps(proj.id, { description: props.description });

    const owner = str(p.role).toLowerCase();
    if (owner) {
      const hit = roleNodes.find((r) => (r.company && (r.company.toLowerCase().includes(owner) || owner.includes(r.company.toLowerCase()))) || r.title.toLowerCase().includes(owner));
      if (hit) await w.edge(proj.id, hit.id, "part_of");
    }
    let order = 0;
    for (const bt of bullets) {
      const m = await addMetricNode(w, proj.id, { text: bt }, bt, order++, source);
      for (const s of m.skills) if (!skills.includes(s)) skills.push(s);
    }
    for (const s of skills) {
      const sk = await w.node({ type: "skill", label: s, source });
      await w.edge(proj.id, sk.id, "used");
    }
  }

  // ----- profile -----
  const profile = await getProfile(db, userId);
  const patch: ProfilePatch = {};
  for (const k of PROFILE_KEYS) {
    const v = str(contact[k]);
    if (v && !profile[k]) patch[k] = v;
  }
  await db.update(profiles).set({ ...patch, rawResumeText: text, updatedAt: new Date() }).where(eq(profiles.userId, userId));

  return { nodesCreated: w.nodesCreated, edgesCreated: w.edgesCreated, usedLLM, profilePatch: patch, contact };
}

// ---------------------------------------------------------------- contact merge
type LlmContact = NonNullable<ResumeStruct["contact"]>;
const RULE_WINS = 0.9;
const LLM_CONF = 0.85;

/** True when a URL the model returned is actually present in the document (as a link or in the text). */
function urlInDocument(url: string, text: string, links: ExtractedLink[]): boolean {
  const n = normalizeUrl(url);
  if (!n) return false;
  const bare = n.replace(/^https:\/\//, "").toLowerCase();
  if (links.some((l) => normalizeUrl(l.url)?.toLowerCase() === n.toLowerCase())) return true;
  return text.toLowerCase().replace(/\/\s+/g, "/").includes(bare);
}

/**
 * Rule-based fields with confidence >= 0.9 win; the model fills the rest. Model URLs, emails and phones
 * must appear in the document, so a hallucinated profile link can never reach the profile.
 */
export function mergeContact(rule: ContactInfo, llm: LlmContact | null | undefined, text: string, links: ExtractedLink[]): ContactInfo {
  if (!llm) return rule;
  const out: ContactInfo = { ...rule, otherLinks: [...rule.otherLinks], confidence: { ...rule.confidence } };
  const digits = text.replace(/\D/g, "");
  const lower = text.toLowerCase();
  const mailtos = links.filter((l) => /^mailto:/i.test(l.url)).map((l) => l.url.slice(7).toLowerCase());
  const valid: Record<string, (v: string) => string | null> = {
    email: (v) => (lower.includes(v.toLowerCase()) || mailtos.some((m) => m.startsWith(v.toLowerCase())) ? v : null),
    phone: (v) => { const d = v.replace(/\D/g, ""); return d.length >= 7 && digits.includes(d) ? v : null; },
    linkedin: (v) => (urlInDocument(v, text, links) ? classifyUrl(normalizeUrl(v)!).profile ?? normalizeUrl(v) : null),
    github: (v) => (urlInDocument(v, text, links) ? normalizeUrl(v) : null),
    website: (v) => (urlInDocument(v, text, links) ? normalizeUrl(v) : null),
  };
  let locationChanged = false;
  for (const k of ["fullName", "email", "phone", "city", "state", "country", "linkedin", "github", "website"] as const) {
    const raw = str(llm[k]);
    if (!raw) continue;
    if ((out.confidence[k] ?? 0) >= RULE_WINS && out[k]) continue;
    const v = valid[k] ? valid[k](raw) : raw;
    if (!v) continue;
    if (k === "country") out.country = canonicalCountry(v) ?? v;
    else out[k] = v;
    out.confidence[k] = LLM_CONF;
    if (k === "city" || k === "state") locationChanged = true;
  }
  if (locationChanged && out.city) {
    out.location = [out.city, out.state || out.country].filter(Boolean).join(", ");
    out.confidence.location = Math.min(out.confidence.city ?? LLM_CONF, LLM_CONF);
  }
  const have = new Set([out.linkedin, out.github, out.website, ...out.otherLinks.map((l) => l.url)].filter(Boolean));
  for (const l of llm.otherLinks ?? []) {
    const url = normalizeUrl(l.url);
    if (!url || have.has(url) || !urlInDocument(url, text, links)) continue;
    have.add(url);
    out.otherLinks.push({ kind: str(l.kind) || classifyUrl(url).kind, url, ...(str(l.label) ? { label: str(l.label) } : {}) });
  }
  return out;
}

type BulletInput = { text: string; metrics?: { statement: string; value?: string | number | null; unit?: string | null }[] | null; skills?: string[] | null; quote?: string | null };

/** One metric node per bullet line; links owner (role or project) -> metric with `achieved`. */
async function addMetricNode(w: GraphWriter, ownerId: string, b: BulletInput, text: string, order: number, source: string): Promise<{ id: string; skills: string[] }> {
  const metrics = b.metrics?.length ? b.metrics : extractMetrics(text);
  const withValue = metrics.find((m) => m.value != null && String(m.value).trim() !== "");
  const q = withValue ? null : extractQuantity(text);
  const value = withValue ? String(withValue.value).trim() : q?.value ?? null;
  const unit = withValue ? str(withValue.unit) || null : q?.unit ?? null;
  const skills = uniq([...(b.skills ?? []).map((s) => normalizeSkill(str(s))), ...findSkills(text)].filter(Boolean));
  const props = {
    statement: text, value, unit, hasNumber: value !== null, skills, order,
    metrics: metrics.map((m) => ({ statement: m.statement, value: m.value == null ? null : String(m.value), unit: m.unit ?? null })),
  };
  const node = await w.node({ type: "metric", label: text, props, source, sourceQuote: str(b.quote) || text });
  await w.edge(ownerId, node.id, "achieved");
  return { id: node.id, skills };
}
