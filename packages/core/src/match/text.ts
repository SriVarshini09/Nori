import { findSkills, canonicalSkill } from "../graph/skills.js";

/** Text helpers shared by match/ and tailor/. Pure, no I/O. */

export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const reCache = new Map<string, RegExp>();
const canonCache = new Map<string, string>();
/** Whole-term, case-insensitive match that understands C++, C#, Node.js, .NET and trailing punctuation. */
export function containsTerm(text: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  let re = reCache.get(t);
  if (!re) {
    const body = escapeRe(t).replace(/\s+/g, "[\\s-]+");
    re = new RegExp(`(?<![a-z0-9+#.])${body}(?![a-z0-9+#]|\\.[a-z0-9])`, "i");
    reCache.set(t, re);
  }
  return re.test(text);
}

/** Canonical (normalized) skill name via the graph dictionary, falling back to the input. */
export function canon(name: string): string {
  const hit = canonCache.get(name);
  if (hit !== undefined) return hit;
  const out = computeCanon(name);
  if (canonCache.size > 5000) canonCache.clear();
  canonCache.set(name, out);
  return out;
}

function computeCanon(name: string): string {
  let c: unknown = null;
  try { c = (canonicalSkill as (s: string) => unknown)(name); } catch { c = null; }
  if (typeof c === "string" && c.trim()) return norm(c);
  if (c && typeof c === "object" && "name" in c) return norm(String((c as { name: unknown }).name));
  return norm(name);
}

/** Canonical skill names the dictionary finds in free text. */
const skillsCache = new Map<string, Set<string>>();
export function skillsIn(text: string): Set<string> {
  const cached = skillsCache.get(text);
  if (cached) return cached;
  const out = computeSkillsIn(text);
  if (skillsCache.size > 5000) skillsCache.clear();
  skillsCache.set(text, out);
  return out;
}

function computeSkillsIn(text: string): Set<string> {
  let found: unknown = [];
  try { found = (findSkills as (s: string) => unknown)(text); } catch { found = []; }
  const out = new Set<string>();
  if (Array.isArray(found)) {
    for (const f of found) {
      if (typeof f === "string") out.add(canon(f));
      else if (f && typeof f === "object") {
        const o = f as Record<string, unknown>;
        const n = o.canonical ?? o.name ?? o.label;
        if (typeof n === "string") out.add(canon(n));
      }
    }
  }
  return out;
}

/** True when the skill is mentioned in the text directly or through a dictionary alias. */
export function mentionsSkill(text: string, skill: string): boolean {
  if (!text) return false;
  if (containsTerm(text, skill)) return true;
  const c = canon(skill);
  if (c !== norm(skill) && containsTerm(text, c)) return true;
  return skillsIn(text).has(c);
}

/** Two skill names refer to the same thing. */
export function sameSkill(a: string, b: string): boolean {
  return norm(a) === norm(b) || canon(a) === canon(b);
}

const STOP = new Set(
  ("a an and the of to in on for with by at as or from into via is are be been being was were this that these those " +
    "it its our your their you we they he she i me my us them who what which while than then so such not no nor can " +
    "will would should could may might must have has had do does did done using use used across within over under per " +
    "experience experienced years year strong ability able knowledge working work skills skill proven solid good great " +
    "excellent deep hands-on understanding familiarity familiar plus preferred required requirement including include " +
    "etc other related relevant similar least minimum more most well both any all each every also new building build")
    .split(/\s+/),
);

/** Lowercased content words with light plural stemming. */
export function contentWords(s: string): string[] {
  const toks = norm(s).match(/[a-z0-9][a-z0-9+#.]*/g) ?? [];
  const out: string[] = [];
  for (let t of toks) {
    t = t.replace(/\.+$/, "");
    if (!t || STOP.has(t)) continue;
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    if (t.length < 2 && !/^[cr]$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

/** Number of distinct content words two strings share. */
export function sharedWords(a: string, b: string): number {
  const wa = new Set(contentWords(a));
  let n = 0;
  for (const w of new Set(contentWords(b))) if (wa.has(w)) n++;
  return n;
}

/** Fuzzy phrase coverage: shares 2+ content words (or the only one, for one-word phrases). */
export function phraseCovered(phrase: string, text: string): boolean {
  const need = Math.min(2, new Set(contentWords(phrase)).size);
  if (need === 0) return false;
  return sharedWords(phrase, text) >= need;
}

/** Join ["a","b","c"] as "a, b and c". */
export function joinList(items: string[], conj = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** All digit runs in a string ("2.5M", "40%" -> "2.5", "40"). */
export function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}
