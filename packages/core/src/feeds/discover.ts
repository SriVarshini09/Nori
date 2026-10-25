import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DiscoverQuery, NormalizedJob } from "../contracts.js";
import type { Db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { exaAvailable, exaSearch } from "./exa.js";
import { resolveGreenhouseEmbedId } from "./greenhouse.js";
import { htmlToText } from "./html.js";
import { FETCH_TIMEOUT_MS, prettifyToken, safeUrl } from "./http.js";
import { extractJsonLdPostings, selectRichestPosting } from "./jsonld.js";
import { upsertJobs } from "./normalize.js";
import { parallelAvailable, parallelExtract, parallelSearch } from "./parallel.js";
import { decodePageBytes, guardPostingHtml, sanitizePostingText } from "./posting-guard.js";
import { discoverPublicBoardJobs } from "./public-boards.js";
import { FEEDS, matchFeedUrl } from "./registry.js";
import { SOCIAL_SOURCES, postingFromResult, sourceFor } from "./social.js";
import { safeFetch, UnsafeUrlError } from "./ssrf.js";

export const ATS_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "myworkdayjobs.com",
  "apply.workable.com",
  "ats.rippling.com",
  "recruitee.com",
  "bamboohr.com",
  "pinpointhq.com",
  "breezy.hr",
  "app.dover.com",
];

/** ATS vendors where single-job lookup is cheaper/richer than fetching the entire tenant board. */
const SINGLE_JOB_FIRST = new Set(["smartrecruiters", "workday", "workable", "bamboohr"]);

export type JobRow = typeof jobs.$inferSelect;

type Hint = { title?: string | null; excerpts?: string[] };
type TenantCache = Map<string, Promise<NormalizedJob[] | null>>;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

function cleanUrl(url: string): string {
  const u = safeUrl(url.trim());
  if (!u) throw new Error(`Not a valid URL: ${url}`);
  u.hash = "";
  return u.toString();
}

/** 2-3 short keyword queries (Parallel works best with 3-6 word queries). */
export function buildSearchQueries(q: DiscoverQuery): string[] {
  const titles = (q.titles ?? []).map((t) => t.trim()).filter(Boolean);
  const locs = (q.locations ?? []).map((l) => l.trim()).filter(Boolean);
  const where = q.remote ? "remote" : locs[0] ?? "";
  const out: string[] = [];
  const base = titles[0] ?? q.objective.split(/\s+/).slice(0, 5).join(" ");
  out.push(`${base} ${where} job opening`.replace(/\s+/g, " ").trim());
  if (titles[1]) out.push(`${titles[1]} ${where} hiring`.replace(/\s+/g, " ").trim());
  if (locs[0] && q.remote) out.push(`${base} ${locs[0]} apply`.replace(/\s+/g, " ").trim());
  if (out.length < 3) out.push(q.objective.split(/\s+/).slice(0, 10).join(" "));
  return [...new Set(out)].slice(0, 3);
}

async function tenantJobs(cache: TenantCache, atsType: string, token: string, load: () => Promise<NormalizedJob[]>) {
  const key = `${atsType}:${token}`;
  let p = cache.get(key);
  if (!p) {
    p = load().catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function fetchPageDirect(url: string): Promise<{ title?: string; text: string; html: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; jobgraph)", accept: "text/html" } });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const rawBytes = new Uint8Array(await res.arrayBuffer());
    const html = decodePageBytes(rawBytes).slice(0, 500_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const guarded = guardPostingHtml(html);
    return {
      title: title ? htmlToText(title).replace(/\s+/g, " ") : undefined,
      text: sanitizePostingText(htmlToText(guarded.cleanedHtml)).slice(0, 50_000),
      html,
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstHeading(md: string): string | undefined {
  const h = md.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (h) return h.replace(/[*_`]/g, "").trim();
  return md.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 120);
}

/**
 * Resolve one URL to a NormalizedJob:
 * 1. Direct ATS feed or single-job API (13 supported ATS platforms).
 * 2. Embedded `?gh_jid=` redirect on a corporate domain -> Greenhouse feed.
 * 3. Parallel extract (when configured) or direct fetch with schema.org/JobPosting JSON-LD + Posting Guard.
 */
async function resolveUrl(url: string, via: NormalizedJob["discoveredVia"], cache: TenantCache, hint: Hint = {}): Promise<NormalizedJob | null> {
  const m = matchFeedUrl(url);
  let companyHint: string | undefined;
  if (m) {
    const slugPart = m.token.includes(":") ? m.token.split(":")[0]! : m.token;
    companyHint = prettifyToken(slugPart);
    if (m.externalId) {
      const { feed, token, externalId } = m;
      let job: NormalizedJob | null = null;
      if (SINGLE_JOB_FIRST.has(feed.atsType) && feed.fetchJob) {
        job = await feed.fetchJob(token, externalId).catch(() => null);
      } else {
        const list = await tenantJobs(cache, feed.atsType, token, () => feed.fetchJobs(token));
        job = list?.find((j) => j.externalId.toLowerCase() === externalId.toLowerCase()) ?? null;
        if (!job && feed.fetchJob) {
          job = await feed.fetchJob(token, externalId).catch(() => null);
        }
      }
      if (job) return { ...job, discoveredVia: via };
    }
  } else {
    // Check if the URL is a corporate career page carrying ?gh_jid=<id>
    const ghEmbed = await resolveGreenhouseEmbedId(url);
    if (ghEmbed) {
      companyHint = prettifyToken(ghEmbed.token);
      const ghFeed = FEEDS.greenhouse!;
      const list = await tenantJobs(cache, "greenhouse", ghEmbed.token, () => ghFeed.fetchJobs(ghEmbed.token));
      const job = list?.find((j) => j.externalId === ghEmbed.externalId)
        ?? (ghFeed.fetchJob ? await ghFeed.fetchJob(ghEmbed.token, ghEmbed.externalId).catch(() => null) : null);
      if (job) return { ...job, discoveredVia: via };
    }
  }

  // Fallback: read the page text (Parallel extract, or direct fetch with JSON-LD + Posting Guard).
  let title = hint.title ?? undefined;
  let text = "";
  let rawHtml = "";
  if (parallelAvailable()) {
    try {
      const [ex] = await parallelExtract([url], "Extract the full job posting: title, company, location, responsibilities and requirements.");
      if (ex?.content) {
        text = sanitizePostingText(ex.content);
        title = firstHeading(ex.content) ?? ex.title ?? title;
      }
    } catch { /* fall through to excerpts / direct fetch */ }
  }
  if (!text && hint.excerpts?.length) text = sanitizePostingText(hint.excerpts.join("\n\n"));
  if (!text) {
    try {
      const page = await fetchPageDirect(url);
      rawHtml = page.html;
      text = page.text;
      title = title ?? page.title;
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw err; // say why, instead of "could not read"
      /* otherwise give up below */
    }
  }

  // If we fetched HTML directly, check if schema.org/JobPosting JSON-LD gives a richer structured posting
  if (rawHtml) {
    const ldJob = selectRichestPosting(rawHtml, text, url, via, title, companyHint);
    if (ldJob && ldJob.descriptionText.trim()) return ldJob;
  }

  if (!text.trim()) return null;
  const u = safeUrl(url)!;
  return {
    atsType: "web",
    externalId: sha1(url),
    companyName: companyHint ?? u.hostname.replace(/^(www|jobs|careers)\./, "").split(".")[0],
    title: (title ?? "Untitled role").slice(0, 300),
    remote: /\bremote\b/i.test(`${title ?? ""}\n${text.slice(0, 1500)}`),
    descriptionText: text,
    applyUrl: url,
    discoveredVia: via,
  };
}

/** Is any web search configured? Without one, discovery is limited to the ATS feeds and public boards. */
export const searchAvailable = () => exaAvailable() || parallelAvailable();

/**
 * Zero-key discovery from public JSON boards (Hacker News Who is Hiring, Remotive, Arbeitnow).
 * Resolves any ATS links inside postings and upserts into the database.
 */
export async function discoverPublicJobs(db: Db, query: DiscoverQuery): Promise<{ added: number; jobs: NormalizedJob[] }> {
  const rawJobs = await discoverPublicBoardJobs(query);
  if (!rawJobs.length) return { added: 0, jobs: [] };
  const cache: TenantCache = new Map();
  const upgraded = await Promise.all(
    rawJobs.map(async (j) => {
      const m = matchFeedUrl(j.applyUrl);
      if (m && m.externalId) {
        const resolved = await resolveUrl(j.applyUrl, j.discoveredVia, cache, { title: j.title }).catch(() => null);
        if (resolved) return resolved;
      }
      return j;
    }),
  );
  const { added } = await upsertJobs(db, upgraded);
  return { added, jobs: upgraded };
}

/**
 * Exa search in two sweeps: the ATS boards (each hit resolved through its feed, so the posting is complete), then the
 * social and web sources (X, Hacker News, Wellfound, Y Combinator, public LinkedIn job pages), each hit read as a
 * posting or dropped. Fresh pages only, deduplicated by URL.
 */
export async function discoverJobsExa(db: Db, query: DiscoverQuery): Promise<{ added: number; jobs: NormalizedJob[] }> {
  const queries = buildSearchQueries(query).slice(0, 2);
  const max = query.maxResults ?? 10;
  const cache: TenantCache = new Map();
  const seen = new Set<string>();
  const found: NormalizedJob[] = [];
  let closed = false;
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const claim = (raw: string): string | null => {
    let url: string;
    try { url = cleanUrl(raw); } catch { return null; }
    if (seen.has(url)) return null;
    seen.add(url);
    return url;
  };

  // At most four page reads at once; each source is read as soon as its own results arrive, so a slow source never
  // holds up a fast one.
  let active = 0;
  const waiting: (() => void)[] = [];
  const limited = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };

  const atsSweeps = queries.map((q) => exaSearch({ query: q, numResults: max, includeDomains: ATS_DOMAINS, startPublishedDate: since(60), maxCharacters: 2000 })
    .catch((e) => { console.warn(`[discover] exa ats: ${(e as Error).message}`); return []; })
    .then((hits) => Promise.all(hits.map(async (r) => {
      const url = claim(r.url);
      if (!url || closed) return;
      const m = matchFeedUrl(url);
      if (m && !m.externalId) return;
      try {
        const job = await resolveUrl(url, "exa_search", cache, { title: r.title, excerpts: r.text ? [r.text] : [] });
        if (job && !closed) found.push(job);
      } catch (err) { console.warn(`[discover] skipped ${new URL(url).hostname}: ${(err as Error).message}`); }
    }))));
  const socialSweeps = SOCIAL_SOURCES.map((source) => {
    const q = `${queries[0]} ${source.id === "x" || source.id === "hn" ? "hiring" : ""}`.trim();
    return exaSearch({ query: q, numResults: Math.max(5, Math.ceil(max / 2)), includeDomains: source.domains, category: source.category, startPublishedDate: since(source.freshDays) })
      .catch((e) => { console.warn(`[discover] exa ${source.id}: ${(e as Error).message}`); return []; })
      .then((hits) => Promise.all(hits.map(async (r) => {
        const url = claim(r.url);
        if (!url || closed) return;
        try {
          const job = await limited(() => (closed ? Promise.resolve(null) : postingFromResult(r, sourceFor(url) ?? source)));
          if (job && !closed) found.push(job);
        } catch (err) { console.warn(`[discover] skipped ${new URL(url).hostname}: ${(err as Error).message}`); }
      })));
  });
  const work = Promise.all([...atsSweeps, ...socialSweeps]);
  work.catch(() => undefined);

  // With a budget, take whatever has arrived when it runs out; the rest is dropped rather than waited for.
  const budget = query.budgetMs ? Math.max(3000, Math.round(query.budgetMs * 0.6)) : 0;
  if (budget) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, budget); })]);
    if (timer) clearTimeout(timer);
  } else {
    await work;
  }
  closed = true;
  const done = found.slice();
  const { added } = await upsertJobs(db, done);
  return { added, jobs: done };
}

/** Web search for postings: Exa when its key is set, else Parallel. Each hit becomes a structured job and is upserted. */
export async function discoverJobs(db: Db, query: DiscoverQuery): Promise<{ added: number; jobs: NormalizedJob[] }> {
  if (exaAvailable()) return discoverJobsExa(db, query);
  if (!parallelAvailable()) throw new Error("No web search is configured (EXA_API_KEY or PARALLEL_API_KEY is not set); only the ATS feeds are searched");
  const results = await parallelSearch({
    objective: query.objective,
    search_queries: buildSearchQueries(query),
    include_domains: ATS_DOMAINS,
    max_results: query.maxResults ?? 10,
  });

  const cache: TenantCache = new Map();
  const seen = new Set<string>();
  const found: NormalizedJob[] = [];
  for (const r of results) {
    let url: string;
    try { url = cleanUrl(r.url); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const m = matchFeedUrl(url);
    if (m && !m.externalId) continue; // a board index page, not a posting
    try {
      const job = await resolveUrl(url, "parallel_search", cache, { title: r.title, excerpts: r.excerpts });
      if (job) found.push(job);
    } catch (err) {
      console.warn(`[discover] skipped ${new URL(url).hostname}: ${(err as Error).message}`);
    }
  }
  const { added } = await upsertJobs(db, found);
  return { added, jobs: found };
}

/** Add a single pasted job URL. Returns the stored row. */
export async function addJobFromUrl(db: Db, url: string): Promise<{ job: JobRow; added: boolean }> {
  const clean = cleanUrl(url);
  const m = matchFeedUrl(clean);
  if (m && !m.externalId) throw new Error("That URL is a job board, not a single posting. Paste the URL of a specific job.");
  const job = await resolveUrl(clean, "pasted", new Map());
  if (!job) throw new Error(`Could not read a job posting from ${new URL(clean).hostname}`);
  const { added, ids } = await upsertJobs(db, [job]);
  const [row] = await db.select().from(jobs).where(eq(jobs.id, ids[0])).limit(1);
  return { job: row!, added: added > 0 };
}

/**
 * Read a company's careers page directly for schema.org/JobPosting JSON-LD listings when no known ATS board is found.
 */
export async function ingestCareerPageJsonLd(db: Db, url: string): Promise<{ added: number; total: number; ids: string[]; companyName?: string }> {
  const clean = cleanUrl(url);
  const page = await fetchPageDirect(clean);
  const postings = extractJsonLdPostings(page.html, clean, "feed");
  if (!postings.length) return { added: 0, total: 0, ids: [] };
  const { added, ids } = await upsertJobs(db, postings);
  return { added, total: postings.length, ids, companyName: postings[0]?.companyName };
}
