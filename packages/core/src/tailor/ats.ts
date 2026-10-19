import type { AtsCheck, JobRequirements, ResumeContent } from "../db/schema.js";
import { mentionsSkill, wordCount } from "../match/text.js";
import { startsWithVerb } from "./verbs.js";
import { SECTION_ORDER } from "./template.js";
import { contentText } from "./rewrite.js";

export type AtsReport = { score: number; checks: AtsCheck[] };

const MIN_WORDS = 8;
const MAX_WORDS = 30;
const PRONOUNS = /\b(I|me|my|mine|myself|we|our|ours|us)\b/;
/** Printable ASCII, Latin-1 letters, and common typographic punctuation (dashes, quotes, bullet, ellipsis). */
const SAFE_CHARS = /^[\t\n\r\x20-\x7E -ÿ‐-―‘-‟•…™]*$/;

function allBullets(c: ResumeContent) {
  return [
    ...c.experience.flatMap((r) => r.bullets.map((b) => ({ where: `${r.title} @ ${r.company}`, text: b.text }))),
    ...(c.projects ?? []).flatMap((p) => p.bullets.map((b) => ({ where: p.name, text: b.text }))),
  ].filter((b) => b.text.trim());
}

function short(s: string, n = 48) {
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
}

/**
 * Weighted ATS-readiness checks. Score is the passed weight over the applicable weight, 0..100.
 * `pages` comes from the renderer; the one-page check is skipped when it is unknown.
 */
export function atsChecks(content: ResumeContent, html: string, requirements?: JobRequirements | null, pages?: number): AtsReport {
  const checks: AtsCheck[] = [];
  const add = (id: string, label: string, weight: number, pass: boolean, detail?: string) => checks.push({ id, label, weight, pass, ...(detail ? { detail } : {}) });

  // contact
  const ct = content.contact ?? {};
  const missingContact = [!content.name?.trim() && "name", !ct.email && "email", !(ct.phone || ct.linkedin) && "phone or LinkedIn"].filter(Boolean) as string[];
  add("contact", "Contact info present (name, email, phone or LinkedIn)", 10, missingContact.length === 0, missingContact.length ? `Missing ${missingContact.join(", ")}` : undefined);

  // headings
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  const known = h2s.filter((h) => (SECTION_ORDER as readonly string[]).includes(h));
  const idx = known.map((h) => (SECTION_ORDER as readonly string[]).indexOf(h));
  const inOrder = idx.every((v, i) => i === 0 || v > idx[i - 1]);
  const required = ["Experience", "Education", "Skills"].filter((h) => !h2s.includes(h));
  const unknown = h2s.filter((h) => !known.includes(h));
  add("headings", "Standard section headings, in order", 10, required.length === 0 && inOrder && unknown.length === 0 && /<h1[\s>]/i.test(html),
    [required.length ? `Missing ${required.join(", ")}` : "", !inOrder ? "Sections out of order" : "", unknown.length ? `Non-standard: ${unknown.join(", ")}` : ""].filter(Boolean).join("; ") || undefined);

  // layout
  const layoutIssues = [
    /<table[\s>]/i.test(html) && "table",
    /<img[\s>]/i.test(html) && "image",
    /<svg[\s>]/i.test(html) && "svg/icon",
    /<i\s+class=|class="[^"]*\b(fa|icon)[\w-]*/i.test(html) && "icon font",
    /column-count|columns\s*:|grid-template-columns|float\s*:\s*(left|right)/i.test(html) && "multi-column CSS",
    /background-image/i.test(html) && "background image",
  ].filter(Boolean) as string[];
  add("layout", "Single column, no tables, images or icons", 10, layoutIssues.length === 0, layoutIssues.length ? `Found ${layoutIssues.join(", ")}` : undefined);

  // bullets
  const bs = allBullets(content);
  const badLen = bs.filter((b) => { const w = wordCount(b.text); return w < MIN_WORDS || w > MAX_WORDS; });
  add("bullet_length", `Bullets are ${MIN_WORDS} to ${MAX_WORDS} words`, 10, bs.length > 0 && badLen.length === 0,
    bs.length === 0 ? "No bullets" : badLen.length ? `${badLen.length} outside range, e.g. "${short(badLen[0].text)}" (${wordCount(badLen[0].text)} words)` : undefined);

  const noVerb = bs.filter((b) => !startsWithVerb(b.text));
  add("action_verbs", "Every bullet starts with an action verb", 10, bs.length > 0 && noVerb.length === 0,
    noVerb.length ? `${noVerb.length} bullet(s), e.g. "${short(noVerb[0].text)}"` : undefined);

  const noDates = content.experience.filter((r) => !r.start && !r.end);
  add("dates", "Dates on every role", 10, content.experience.length > 0 && noDates.length === 0,
    content.experience.length === 0 ? "No experience" : noDates.length ? `No dates: ${noDates.map((r) => r.company || r.title).join(", ")}` : undefined);

  // keywords
  const reqSkills = (requirements?.skills ?? []).filter((s) => s.required).map((s) => s.name);
  if (reqSkills.length > 0) {
    const text = contentText(content);
    const present = reqSkills.filter((s) => mentionsSkill(text, s));
    const cov = present.length / reqSkills.length;
    const absent = reqSkills.filter((s) => !present.includes(s));
    add("keywords", "Covers at least 70% of required skills", 15, cov >= 0.7,
      `${present.length}/${reqSkills.length} (${Math.round(cov * 100)}%)${absent.length ? `; missing ${absent.slice(0, 5).join(", ")}` : ""}`);
  }

  if (typeof pages === "number") add("one_page", "Fits on one page", 15, pages === 1, `${pages} page${pages === 1 ? "" : "s"}`);

  const text = contentText(content);
  const pron = [content.summary ?? "", ...bs.map((b) => b.text)].find((t) => PRONOUNS.test(t.replace(/\bU\.?S\.?\b/g, "")));
  add("pronouns", "No first-person pronouns", 5, !pron, pron ? `"${short(pron)}"` : undefined);

  const bad = [...new Set([...text].filter((ch) => !SAFE_CHARS.test(ch)))];
  add("characters", "Plain, parser-safe characters", 5, bad.length === 0, bad.length ? `Unusual: ${bad.slice(0, 8).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}` : undefined);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const passed = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  return { score: total ? Math.round((passed / total) * 100) : 0, checks };
}
