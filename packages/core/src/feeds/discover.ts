import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DiscoverQuery, NormalizedJob } from "../contracts.js";
import type { Db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { htmlToText } from "./html.js";
import { prettifyToken, safeUrl, FETCH_TIMEOUT_MS } from "./http.js";
import { upsertJobs } from "./normalize.js";
import { parallelAvailable, parallelExtract, parallelSearch } from "./parallel.js";
import { matchFeedUrl } from "./registry.js";

export const ATS_DOMAINS = [
  "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "jobs.smartrecruiters.com",
];

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
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; jobgraph)", accept: "text/html" } });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const html = (await res.text()).slice(0, 500_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return { title: title ? htmlToText(title).replace(/\s+/g, " ") : undefined, text: htmlToText(html).slice(0, 50_000), html };
  } finally {
    clearTimeout(timer);
  }
}

function firstHeading(md: string): string | undefined {
  const h = md.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (h) return h.replace(/[*_`]/g, "").trim();
  return md.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 120);
}

/** Resolve one URL to a NormalizedJob: ATS feed first, then Parallel extract (or a direct fetch). */
async function resolveUrl(url: string, via: NormalizedJob["discoveredVia"], cache: TenantCache, hint: Hint = {}): Promise<NormalizedJob | null> {
  const m = matchFeedUrl(url);
  let companyHint: string | undefined;
  if (m) {
    companyHint = prettifyToken(m.token);
    if (m.externalId) {
      const { feed, token, externalId } = m;
      let job: NormalizedJob | null = null;
      if (feed.atsType === "smartrecruiters" && feed.fetchJob) {
        job = await feed.fetchJob(token, externalId).catch(() => null);
      } else {
        const list = await tenantJobs(cache, feed.atsType, token, () => feed.fetchJobs(token));
        job = list?.find((j) => j.externalId === externalId) ?? null;
      }
      if (job) return { ...job, discoveredVia: via };
    }
  }

  // Fallback: read the page text.
  let title = hint.title ?? undefined;
  let text = "";
  if (parallelAvailable()) {
    try {
      const [ex] = await parallelExtract([url], "Extract the full job posting: title, company, location, responsibilities and requirements.");
      if (ex?.content) {
        text = ex.content;
        title = firstHeading(ex.content) ?? ex.title ?? title;
      }
    } catch { /* fall through to excerpts / direct fetch */ }
  }
  if (!text && hint.excerpts?.length) text = hint.excerpts.join("\n\n");
  if (!text) {
    try {
      const page = await fetchPageDirect(url);
      text = page.text;
      title = title ?? page.title;
    } catch { /* give up below */ }
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

/** Parallel search across the supported ATS domains, resolve each hit to a structured job, upsert. */
export async function discoverJobs(db: Db, query: DiscoverQuery): Promise<{ added: number; jobs: NormalizedJob[] }> {
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
  return { job: row, added: added > 0 };
}
