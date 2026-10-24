import { createHash } from "node:crypto";
import { z } from "zod";
import type { NormalizedJob } from "../contracts.js";
import { getLLM, withFallback } from "../llm/index.js";
import type { ExaResult } from "./exa.js";

/**
 * Turning a page found by web search (an X post, a Hacker News "Who is hiring" comment, a Wellfound or Y Combinator
 * listing, a public LinkedIn job page) into a job posting. Rules first, so it works with no model; the bulk model,
 * when one is configured, reads the page more carefully and can say "this is not a posting".
 */

export type SocialSource = {
  id: "x" | "hn" | "wellfound" | "yc" | "linkedin";
  label: string;
  domains: string[];
  category?: "tweet";
  /** Days back to search; chatter goes stale fast. */
  freshDays: number;
};

export const SOCIAL_SOURCES: SocialSource[] = [
  // Exa dropped its "tweet" category (400 since Oct 2026); the domain filter alone selects X posts.
  { id: "x", label: "X", domains: ["x.com", "twitter.com"], freshDays: 30 },
  { id: "hn", label: "Hacker News", domains: ["news.ycombinator.com"], freshDays: 45 },
  { id: "wellfound", label: "Wellfound", domains: ["wellfound.com"], freshDays: 60 },
  { id: "yc", label: "Y Combinator", domains: ["ycombinator.com"], freshDays: 60 },
  { id: "linkedin", label: "LinkedIn", domains: ["linkedin.com"], freshDays: 45 },
];

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const HIRING = /\b(hiring|we(?:'|’)re looking for|we are looking for|open role|open position|join (?:our|the) team|apply (?:here|now|at)|job opening|is seeking|now hiring)\b/i;
const NOT_A_POSTING = /\b(i(?:'|’)m looking for (?:a|my next) (?:job|role)|open to work|#opentowork|seeking (?:a )?(?:new )?(?:role|opportunity|position)|looking for (?:new )?opportunities)\b/i;

export function sourceFor(url: string): SocialSource | null {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  return SOCIAL_SOURCES.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? null;
}

/** The first link in a post that leaves the social site itself: usually the application page. */
export function applyLinkIn(text: string, pageUrl: string): string | null {
  const host = (() => { try { return new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      if (h && h !== host && !h.endsWith("twitter.com") && !h.endsWith("x.com") && !h.endsWith("ycombinator.com")) return u;
    } catch { /* not a URL after all */ }
  }
  return null;
}

type Guess = { isPosting: boolean; title: string; company: string; location?: string; remote: boolean };

/** Rules-only reading of a search hit. Cheap and offline; the model refines it when available. */
export function heuristicPosting(r: ExaResult, source: SocialSource): Guess {
  const title = clean(r.title);
  const text = clean(r.text);
  const head = `${title}\n${text.slice(0, 1200)}`;
  const remote = /\bremote\b/i.test(head);
  let company = "";
  let role = "";
  if (source.id === "hn") {
    // "Company | Role | Location | REMOTE | ..." is the thread's convention.
    const parts = text.split("|").map((p) => clean(p)).filter(Boolean);
    if (parts.length >= 2 && parts[0].length < 60) { company = parts[0]; role = parts[1].slice(0, 120); }
  } else if (source.id === "linkedin") {
    const m = /^(.+?) hiring (.+?)(?: in (.+?))?(?: \| LinkedIn)?$/i.exec(title);
    if (m) { company = m[1]; role = m[2]; return { isPosting: true, title: role, company, location: m[3]?.trim(), remote }; }
  } else if (source.id === "wellfound" || source.id === "yc") {
    const m = /^(.+?) at (.+?)(?: \| .*)?$/i.exec(title);
    if (m) { role = m[1]; company = m[2].replace(/\s*\|\s*Y Combinator.*$/i, ""); }
  } else if (source.id === "x") {
    company = clean(r.author).replace(/^@/, "");
    const m = /(?:hiring|looking for)\s+(?:an?\s+)?([A-Z][A-Za-z0-9+#./ -]{3,60}?)(?=\s+(?:to|at|in|for|who|with|[.!,]|$))/.exec(head);
    if (m) role = m[1].trim();
  }
  if (!role) role = title.replace(/\s*[|–-]\s*(jobs?|careers?|hiring|linkedin|x|twitter).*$/i, "").slice(0, 120) || "Role";
  if (!company) {
    company = clean(r.author).replace(/^@/, "") || source.label;
  }
  const isPosting = HIRING.test(head) && !NOT_A_POSTING.test(head);
  return { isPosting, title: role, company, remote };
}

const PostingSchema = z.object({
  isPosting: z.boolean(),
  title: z.string().max(160),
  company: z.string().max(160),
  location: z.string().max(160).nullable().optional(),
  remote: z.boolean(),
});

/** A job posting from a search hit, or null when it is not one. Model when available, rules otherwise. */
export async function postingFromResult(r: ExaResult, source: SocialSource): Promise<NormalizedJob | null> {
  const text = clean(r.text);
  if (text.length < 80) return null;
  const rules = heuristicPosting(r, source);
  const { value } = await withFallback<Guess>(async () => {
    const out = await getLLM("bulk").json({
      name: "social-posting",
      system: "You read a web page found by search and decide whether it is a job posting by an employer (not someone looking for a job). Extract the role title, the hiring company, the location and whether it is remote. Never invent a company or title; use what the page says.",
      prompt: `Source: ${source.label}\nURL: ${r.url}\nTitle: ${r.title ?? ""}\nAuthor: ${r.author ?? ""}\n\n${text.slice(0, 4000)}`,
      schema: PostingSchema,
      maxTokens: 300,
      effort: "low",
    });
    return { isPosting: out.isPosting, title: out.title.trim() || rules.title, company: out.company.trim() || rules.company, location: out.location ?? undefined, remote: out.remote };
  }, () => rules, "social-posting", "bulk");
  if (!value.isPosting) return null;
  const applyUrl = applyLinkIn(r.text, r.url) ?? r.url;
  return {
    atsType: "web",
    externalId: sha1(r.url),
    companyName: value.company.slice(0, 160),
    title: value.title.slice(0, 300),
    location: value.location?.slice(0, 160),
    remote: value.remote,
    descriptionText: `${text}\n\nFound on ${source.label}: ${r.url}`,
    applyUrl,
    postedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
    discoveredVia: "exa_social",
  };
}
