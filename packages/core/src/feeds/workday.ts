import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { FETCH_TIMEOUT_MS, getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Workday CXS adapter — modeled on career-ops-hq/career-ops (providers/workday.mjs & liveness-api.mjs).
 *
 * Token format:
 *   - "{tenant}:{shard}:{site}" (e.g. "nvidia:wd5:NVIDIAExternalCareerSite")
 *   - "site:{shard}:{tenant}:{site}" for *.myworkdaysite.com tenants
 *   - "{tenant}:{site}" (auto-probes common Workday shards wd1, wd5, wd3, wd12)
 */

const PAGE_SIZE = 20;
const MAX_PAGES = 15; // 300 jobs per poll cycle to keep board polls fast
const INTER_PAGE_DELAY_MS = 150;
const COMMON_SHARDS = ["wd1", "wd5", "wd3", "wd12", "wd2", "wd10"] as const;

type WdPostingItem = {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
};

type WdSearchResponse = {
  total?: number;
  jobPostings?: WdPostingItem[];
};

type WdJobDetailResponse = {
  jobPostingInfo?: {
    id?: string;
    jobReqId?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    postedOn?: string;
    startDate?: string;
    externalUrl?: string;
    remoteType?: string;
  };
  hiringOrganization?: { name?: string };
};

export type WorkdayEndpoint = {
  tenant: string;
  shard: string;
  site: string;
  origin: string;
  apiJobsUrl: string;
  cxsBase: string;
  jobBase: string;
  token: string;
};

const CAREERS_RE = /^https?:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)(?:\/job\/(.+?))?\/?$/;
const CXS_RE = /^https?:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/wday\/cxs\/([\w-]+)\/([^/?#]+)(?:\/jobs|\/job\/(.+?))?\/?$/;
const SITE_RE = /^https?:\/\/(wd[\w-]*)\.myworkdaysite\.com\/recruiting\/([\w-]+)\/([^/?#]+)(?:\/job\/(.+?))?\/?$/;

/**
 * Strip Workday's cross-site repost disambiguator ("-1", "-2") while keeping real hyphenated
 * requisition IDs like Walmart's "R-2593225" or "JR_2024_00123" intact.
 */
export function stripWorkdayRepostSuffix(raw: string): string {
  const token = raw.trim();
  const m = /^(.*?)-(\d{1,2})$/.exec(token);
  if (!m) return token;
  const base = m[1]!;
  const suffix = m[2]!;
  if (base.includes("-")) {
    // Only strip single-digit 1-9 suffix on hyphenated req IDs (e.g. "req-271559-1" -> "req-271559")
    if (suffix.length !== 1 || suffix === "0") return token;
    return /\d.*[0-9]{2,}$/.test(base) ? base : token;
  }
  return /\d[a-z0-9_]*[0-9]{2,}$/i.test(base) ? base : token;
}

/** Extract the requisition ID from Workday's externalPath (`/job/{Location}/{Title}_{REQ}`). */
export function reqFromExternalPath(externalPath: string | undefined): string | undefined {
  if (!externalPath) return undefined;
  const last = externalPath.split("/").filter(Boolean).pop() ?? "";
  const idx = last.indexOf("_");
  if (idx === -1) return undefined;
  const candidate = stripWorkdayRepostSuffix(last.slice(idx + 1));
  if (candidate.length < 3 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate) || !/\d/.test(candidate)) {
    return undefined;
  }
  return candidate;
}

/** Parse Workday's relative postedOn label ("Posted Today", "Posted Yesterday", "Posted 5 Days Ago"). */
export function parseWorkdayPostedOn(label: string | undefined, now = Date.now()): Date | undefined {
  if (!label) return undefined;
  if (/posted\s+today/i.test(label)) return new Date(now);
  if (/posted\s+yesterday/i.test(label)) return new Date(now - 86_400_000);
  const m = /posted\s+(\d+)(\+?)\s*day/i.exec(label);
  if (!m || m[2] === "+") return undefined; // "Posted 30+ Days Ago" is unbounded
  return new Date(now - Number(m[1]) * 86_400_000);
}

function locationFromPath(externalPath: string | undefined): string | undefined {
  if (!externalPath) return undefined;
  const m = /\/job\/([^/]+)\//.exec(externalPath);
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]).replace(/-/g, " ").trim() || undefined;
  } catch {
    return m[1].replace(/-/g, " ").trim() || undefined;
  }
}

export function resolveWorkdayToken(token: string): WorkdayEndpoint | null {
  const parts = token.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 4 && parts[0] === "site") {
    const [, shard, tenant, site] = parts as [string, string, string, string];
    const origin = `https://${shard}.myworkdaysite.com`;
    return {
      tenant,
      shard,
      site,
      origin,
      apiJobsUrl: `${origin}/wday/cxs/${tenant}/${site}/jobs`,
      cxsBase: `${origin}/wday/cxs/${tenant}/${site}`,
      jobBase: `${origin}/recruiting/${tenant}/${site}`,
      token: `site:${shard}:${tenant}:${site}`,
    };
  }
  if (parts.length === 3) {
    const [tenant, shard, site] = parts as [string, string, string];
    const origin = `https://${tenant}.${shard}.myworkdayjobs.com`;
    return {
      tenant,
      shard,
      site,
      origin,
      apiJobsUrl: `${origin}/wday/cxs/${tenant}/${site}/jobs`,
      cxsBase: `${origin}/wday/cxs/${tenant}/${site}`,
      jobBase: `${origin}/${site}`,
      token: `${tenant}:${shard}:${site}`,
    };
  }
  return null;
}

export function parseWorkdayUrl(rawUrl: string): { endpoint: WorkdayEndpoint; jobPath?: string; externalId?: string } | null {
  const u = safeUrl(rawUrl.trim());
  if (!u) return null;
  const cleaned = `${u.origin}${u.pathname}`;

  const cxs = CXS_RE.exec(cleaned);
  if (cxs) {
    const [, , shard, tenant, site, jobPath] = cxs;
    const ep = resolveWorkdayToken(`${tenant}:${shard}:${site}`);
    if (!ep) return null;
    const reqId = jobPath ? reqFromExternalPath(`/job/${jobPath}`) ?? jobPath : undefined;
    return { endpoint: ep, jobPath, externalId: jobPath ?? reqId };
  }

  const siteMatch = SITE_RE.exec(cleaned);
  if (siteMatch) {
    const [, shard, tenant, site, jobPath] = siteMatch;
    const ep = resolveWorkdayToken(`site:${shard}:${tenant}:${site}`);
    if (!ep) return null;
    return { endpoint: ep, jobPath, externalId: jobPath };
  }

  const m = CAREERS_RE.exec(cleaned);
  if (m) {
    const [, tenant, shard, site, jobPath] = m;
    if (site === "wday") return null;
    const ep = resolveWorkdayToken(`${tenant}:${shard}:${site}`);
    if (!ep) return null;
    return { endpoint: ep, jobPath, externalId: jobPath };
  }

  return null;
}

async function postWorkdayJobsPage(apiJobsUrl: string, offset: number, limit = PAGE_SIZE): Promise<WdSearchResponse | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiJobsUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; jobgraph)",
      },
      body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: "" }),
    });
    if (res.status === 404 || res.status === 422 || res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`POST ${apiJobsUrl} failed: ${res.status}`);
    return (await res.json()) as WdSearchResponse;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOrProbeWorkdayToken(token: string): Promise<WorkdayEndpoint | null> {
  const direct = resolveWorkdayToken(token);
  if (direct) return direct;
  const parts = token.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const [tenant, site] = parts as [string, string];
    for (const shard of COMMON_SHARDS) {
      const candidate = resolveWorkdayToken(`${tenant}:${shard}:${site}`);
      if (!candidate) continue;
      const page = await postWorkdayJobsPage(candidate.apiJobsUrl, 0, 1).catch(() => null);
      if (page && Array.isArray(page.jobPostings)) return candidate;
    }
  }
  return null;
}

function toJobFromListItem(ep: WorkdayEndpoint, item: WdPostingItem): NormalizedJob | null {
  const title = item.title?.trim();
  const extPath = item.externalPath?.trim();
  if (!title || !extPath) return null;
  const normalizedPath = extPath.startsWith("/") ? extPath : `/${extPath}`;
  const reqId = reqFromExternalPath(normalizedPath) ?? normalizedPath.replace(/^\/job\//, "");
  const location = item.locationsText?.trim() || locationFromPath(normalizedPath);
  const applyUrl = `${ep.jobBase}${normalizedPath}`;
  return {
    atsType: "workday",
    externalId: reqId.toLowerCase(),
    companyName: prettifyToken(ep.tenant),
    companyToken: ep.token,
    title,
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: [title, location, ...(item.bulletFields ?? [])].filter(Boolean).join(" — "),
    applyUrl,
    postedAt: parseWorkdayPostedOn(item.postedOn),
    discoveredVia: "feed",
    raw: item,
  };
}

function toJobFromDetail(ep: WorkdayEndpoint, jobPath: string, d: WdJobDetailResponse): NormalizedJob | null {
  const info = d.jobPostingInfo;
  if (!info?.title) return null;
  const cleanPath = jobPath.replace(/^\/?(?:job\/)?/, "");
  const normalizedPath = `/job/${cleanPath}`;
  const reqId = (info.jobReqId ? stripWorkdayRepostSuffix(info.jobReqId) : reqFromExternalPath(normalizedPath)) ?? cleanPath;
  const rawHtml = info.jobDescription ?? "";
  const guarded = guardPostingHtml(rawHtml);
  const locationParts = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean);
  const location = locationParts.join(" | ") || locationFromPath(normalizedPath);
  const applyUrl = info.externalUrl || `${ep.jobBase}${normalizedPath}`;
  return {
    atsType: "workday",
    externalId: reqId.toLowerCase(),
    companyName: d.hiringOrganization?.name || prettifyToken(ep.tenant),
    companyToken: ep.token,
    title: info.title.trim(),
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(info.title) || REMOTE_RE.test(info.remoteType ?? ""),
    descriptionText: htmlToText(guarded.cleanedHtml) || info.title,
    descriptionHtml: guarded.cleanedHtml || undefined,
    applyUrl,
    postedAt: parseWorkdayPostedOn(info.postedOn) ?? parseDate(info.startDate),
    discoveredVia: "feed",
    raw: d,
  };
}

export const workday: FeedSourceExt = {
  atsType: "workday",
  async fetchJobs(token) {
    const ep = await resolveOrProbeWorkdayToken(token);
    if (!ep) return [];
    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      if (pageIdx > 0) await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
      const offset = pageIdx * PAGE_SIZE;
      const page = await postWorkdayJobsPage(ep.apiJobsUrl, offset, PAGE_SIZE);
      if (!page) break;
      const batch = page.jobPostings ?? [];
      if (!batch.length) break;

      for (const item of batch) {
        const job = toJobFromListItem(ep, item);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }

      if (batch.length < PAGE_SIZE) break;
      if (typeof page.total === "number" && page.total > 0 && offset + batch.length >= page.total) break;
    }
    return out;
  },

  async fetchJob(token, externalId) {
    const ep = await resolveOrProbeWorkdayToken(token);
    if (!ep) return null;
    const cleanPath = externalId.replace(/^\/?(?:job\/)?/, "");
    const detailUrl = `${ep.cxsBase}/job/${cleanPath}`;
    const d = await getJson<WdJobDetailResponse>(detailUrl).catch(() => null);
    if (d?.jobPostingInfo?.title) {
      return toJobFromDetail(ep, cleanPath, d);
    }
    return null;
  },

  parseUrl(url) {
    const parsed = parseWorkdayUrl(url);
    if (!parsed) return null;
    return { token: parsed.endpoint.token, externalId: parsed.externalId };
  },
};
