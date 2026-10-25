import { createHash } from "node:crypto";
import type { DiscoverQuery, NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, REMOTE_RE } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";
import { matchFeedUrl } from "./registry.js";

/**
 * Zero-key public job discovery engine — modeled on career-ops-hq/career-ops:
 *   1. Hacker News "Ask HN: Who is hiring?" via Algolia HN API (providers/hackernews.mjs)
 *   2. Remotive public JSON API (providers/remotive.mjs)
 *   3. Arbeitnow public JSON API (providers/arbeitnow.mjs)
 *   4. Jobicy public JSON API (providers/jobicy.mjs)
 *
 * Works with ZERO API keys, so discovery succeeds even when EXA_API_KEY and PARALLEL_API_KEY
 * are absent or rate-limited.
 */

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5";
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const COMPANY_PLACEHOLDER_RE = /^[[<({]?\s*(?:company(?:\s+name)?|name)\s*[\]>)}]?$/i;

const STOPWORDS = new Set([
  "find", "search", "look", "for", "me", "my", "show", "get", "some", "any", "role", "roles",
  "job", "jobs", "position", "positions", "opening", "openings", "work", "remote", "remotely",
  "anywhere", "in", "at", "a", "an", "the", "and", "or", "with", "on", "of", "to", "new",
  "open", "please", "near", "based", "hybrid", "hiring", "apply",
]);

export function queryKeywords(q: DiscoverQuery): string[] {
  const raw = [...(q.titles ?? []), q.objective ?? ""].join(" ").toLowerCase();
  const words = raw.split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

export function matchesDiscoverQuery(job: { title: string; descriptionText: string; location?: string; remote: boolean }, q: DiscoverQuery): boolean {
  if (q.remote && !job.remote) return false;
  const titles = (q.titles ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const titleLower = job.title.toLowerCase();
  const hay = `${job.title}\n${job.location ?? ""}\n${job.descriptionText.slice(0, 1200)}`.toLowerCase();

  if (titles.length > 0) {
    const titleHit = titles.some((t) => {
      if (titleLower.includes(t)) return true;
      const tokens = t.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      return tokens.length > 0 && tokens.every((tk) => hay.includes(tk));
    });
    if (!titleHit) return false;
  } else {
    const kws = queryKeywords(q);
    if (kws.length > 0 && !kws.some((kw) => hay.includes(kw))) return false;
  }

  const locs = (q.locations ?? []).map((l) => l.trim().toLowerCase()).filter((l) => l && l !== "remote");
  if (locs.length > 0 && !q.remote && !job.remote) {
    const locLower = (job.location ?? "").toLowerCase();
    if (locLower && !locs.some((l) => locLower.includes(l))) return false;
  }
  return true;
}

function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => {
    let trimmed = u.replace(/[.,;!?)]+$/, "");
    const count = (ch: string) => trimmed.split(ch).length - 1;
    while (trimmed.endsWith("]") && count("]") > count("[")) trimmed = trimmed.slice(0, -1);
    return trimmed;
  });
}

function pickBestApplyUrl(urls: string[], fallbackUrl: string): string {
  for (const u of urls) {
    if (matchFeedUrl(u)) return u;
  }
  for (const u of urls) {
    if (/\/(?:careers?|jobs|apply|positions|openings)(?:\/|$|\?)/i.test(u)) return u;
  }
  return urls[0] ?? fallbackUrl;
}

export function parseHnHiringComment(
  comment: { id: number | string; text?: string | null; created_at?: string },
): NormalizedJob | null {
  if (!comment.text) return null;
  const guarded = guardPostingHtml(comment.text);
  const plain = htmlToText(guarded.cleanedHtml);
  const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const header = lines[0]!;
  const parts = header.split("|").map((p) => p.replace(URL_RE, "").trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const rawCompany = parts[0]!.replace(/\(\s*\)|\[\s*\]/g, "").trim();
  if (!rawCompany || rawCompany.length > 80 || COMPANY_PLACEHOLDER_RE.test(rawCompany)) return null;

  const title = parts[1]!.slice(0, 200).trim();
  if (!title || title.length < 2) return null;

  const restParts = parts.slice(2);
  const remote = REMOTE_RE.test(header) || REMOTE_RE.test(plain.slice(0, 600));
  const locPart = restParts.find((p) => !/^(?:full[- ]?time|part[- ]?time|contract|onsite|visa|https?:|\$\d)/i.test(p));
  const location = locPart?.slice(0, 120) || (remote ? "Remote" : undefined);

  const hnUrl = `https://news.ycombinator.com/item?id=${comment.id}`;
  const urls = extractUrls(plain);
  const applyUrl = pickBestApplyUrl(urls, hnUrl);

  return {
    atsType: "web",
    externalId: `hn:${comment.id}`,
    companyName: rawCompany,
    title,
    location,
    remote,
    descriptionText: `${plain}\n\nFound on Hacker News: ${hnUrl}`,
    descriptionHtml: guarded.cleanedHtml || undefined,
    applyUrl,
    postedAt: parseDate(comment.created_at),
    discoveredVia: "exa_social",
  };
}

/** Fetch matching postings from the latest "Ask HN: Who is hiring?" thread via Algolia HN API. */
export async function fetchHnWhoIsHiring(query: DiscoverQuery, limit = 15): Promise<NormalizedJob[]> {
  type HnHit = { objectID: string; title?: string };
  const search = await getJson<{ hits?: HnHit[] }>(HN_SEARCH_URL, {}, 10_000).catch(() => null);
  const story = (search?.hits ?? []).find((h) => /who is hiring/i.test(h.title ?? ""));
  if (!story?.objectID) return [];

  type HnItem = { id: number; children?: { id: number; text?: string | null; created_at?: string }[] };
  const thread = await getJson<HnItem>(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(story.objectID)}`, {}, 12_000).catch(() => null);
  if (!thread?.children?.length) return [];

  const out: NormalizedJob[] = [];
  for (const child of thread.children) {
    const job = parseHnHiringComment(child);
    if (!job) continue;
    if (matchesDiscoverQuery(job, query)) {
      out.push(job);
      if (out.length >= limit) break;
    }
  }
  return out;
}

type RemotiveJob = {
  id: number | string;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  publication_date?: string;
  description?: string;
};

/** Fetch matching remote jobs from Remotive's public API. */
export async function fetchRemotiveJobs(query: DiscoverQuery, limit = 15): Promise<NormalizedJob[]> {
  const searchTerm = (query.titles?.[0] ?? queryKeywords(query).slice(0, 3).join(" ")).trim();
  const url = searchTerm
    ? `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchTerm)}&limit=30`
    : `https://remotive.com/api/remote-jobs?limit=30`;
  const data = await getJson<{ jobs?: RemotiveJob[] }>(url, {}, 10_000).catch(() => null);
  const out: NormalizedJob[] = [];
  for (const r of data?.jobs ?? []) {
    if (!r.title || !r.company_name || !r.url) continue;
    const guarded = guardPostingHtml(r.description ?? "");
    const job: NormalizedJob = {
      atsType: "web",
      externalId: `remotive:${r.id ?? sha1(r.url)}`,
      companyName: r.company_name.trim(),
      title: r.title.trim(),
      location: r.candidate_required_location?.trim() || "Remote",
      remote: true,
      descriptionText: htmlToText(guarded.cleanedHtml) || r.title,
      descriptionHtml: guarded.cleanedHtml || undefined,
      applyUrl: r.url,
      postedAt: parseDate(r.publication_date),
      discoveredVia: "feed",
    };
    if (matchesDiscoverQuery(job, query)) {
      out.push(job);
      if (out.length >= limit) break;
    }
  }
  return out;
}

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  location?: string;
  created_at?: number;
};

/** Fetch matching jobs from Arbeitnow's public API. */
export async function fetchArbeitnowJobs(query: DiscoverQuery, limit = 15): Promise<NormalizedJob[]> {
  const data = await getJson<{ data?: ArbeitnowJob[] }>("https://www.arbeitnow.com/api/job-board-api", {}, 10_000).catch(() => null);
  const out: NormalizedJob[] = [];
  for (const r of data?.data ?? []) {
    if (!r.title || !r.company_name || !r.url) continue;
    const guarded = guardPostingHtml(r.description ?? "");
    const createdMs = typeof r.created_at === "number" ? (r.created_at < 1e12 ? r.created_at * 1000 : r.created_at) : undefined;
    const job: NormalizedJob = {
      atsType: "web",
      externalId: `arbeitnow:${r.slug || sha1(r.url)}`,
      companyName: r.company_name.trim(),
      title: r.title.trim(),
      location: r.location?.trim() || (r.remote ? "Remote" : undefined),
      remote: Boolean(r.remote) || REMOTE_RE.test(r.location ?? "") || REMOTE_RE.test(r.title),
      descriptionText: htmlToText(guarded.cleanedHtml) || r.title,
      descriptionHtml: guarded.cleanedHtml || undefined,
      applyUrl: r.url,
      postedAt: parseDate(createdMs),
      discoveredVia: "feed",
    };
    if (matchesDiscoverQuery(job, query)) {
      out.push(job);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Run all zero-key public job sources in parallel. */
export async function discoverPublicBoardJobs(query: DiscoverQuery): Promise<NormalizedJob[]> {
  const max = query.maxResults ?? 15;
  const [hn, remotive, arbeitnow] = await Promise.all([
    fetchHnWhoIsHiring(query, max).catch(() => []),
    fetchRemotiveJobs(query, max).catch(() => []),
    fetchArbeitnowJobs(query, max).catch(() => []),
  ]);
  const seenUrls = new Set<string>();
  const combined: NormalizedJob[] = [];
  for (const job of [...hn, ...remotive, ...arbeitnow]) {
    if (seenUrls.has(job.applyUrl)) continue;
    seenUrls.add(job.applyUrl);
    combined.push(job);
    if (combined.length >= max * 2) break;
  }
  return combined;
}
