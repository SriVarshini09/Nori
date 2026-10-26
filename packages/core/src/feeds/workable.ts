import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Workable adapter — modeled on career-ops-hq/career-ops (providers/workable.mjs & liveness-api.mjs):
 *   - Board API: GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
 *   - Single-job API: GET https://apply.workable.com/api/v2/accounts/<slug>/jobs/<shortcode>
 */

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type WorkableWidgetJob = {
  title?: string;
  shortcode?: string;
  shortlink?: string;
  url?: string;
  department?: string;
  city?: string;
  state?: string;
  country?: string;
  telecommuting?: boolean;
  published_on?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
};

type WorkableWidgetResponse = {
  name?: string;
  description?: string;
  jobs?: WorkableWidgetJob[];
};

type WorkableV2JobResponse = {
  id?: string;
  shortcode?: string;
  title?: string;
  state?: string;
  department?: string[];
  description?: string;
  requirements?: string;
  benefits?: string;
  published?: string;
  remote?: boolean;
  location?: { city?: string; region?: string; country?: string; workplace_type?: string };
};

function formatLocation(city?: string, state?: string, country?: string): string | undefined {
  return [city, state, country].map((s) => s?.trim()).filter(Boolean).join(", ") || undefined;
}

function toWidgetJob(token: string, companyName: string, j: WorkableWidgetJob): NormalizedJob | null {
  const title = j.title?.trim();
  const shortcode = j.shortcode?.trim();
  if (!title || !shortcode) return null;
  const html = [j.description, j.requirements, j.benefits].filter(Boolean).join("\n");
  const guarded = guardPostingHtml(html);
  const location = formatLocation(j.city, j.state, j.country);
  const remote = Boolean(j.telecommuting) || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title);
  const applyUrl = j.url || j.shortlink || `https://apply.workable.com/${token}/j/${shortcode}/`;
  return {
    atsType: "workable",
    externalId: shortcode,
    companyName,
    companyToken: token,
    title,
    location,
    remote,
    descriptionText: htmlToText(guarded.cleanedHtml) || title,
    descriptionHtml: guarded.cleanedHtml || undefined,
    applyUrl,
    postedAt: parseDate(j.published_on),
    discoveredVia: "feed",
    raw: j,
  };
}

export const workable: FeedSourceExt = {
  atsType: "workable",
  async fetchJobs(token) {
    if (!SLUG_RE.test(token)) return [];
    const data = await getJson<WorkableWidgetResponse>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
    ).catch(() => null);
    if (!data?.jobs) return [];
    const companyName = data.name?.trim() || prettifyToken(token);
    return data.jobs.map((j) => toWidgetJob(token, companyName, j)).filter((j): j is NormalizedJob => j !== null);
  },

  async fetchJob(token, externalId) {
    if (!SLUG_RE.test(token) || !SLUG_RE.test(externalId)) return null;
    const d = await getJson<WorkableV2JobResponse>(
      `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(token)}/jobs/${encodeURIComponent(externalId)}`,
    ).catch(() => null);
    if (d?.title) {
      const html = [d.description, d.requirements, d.benefits].filter(Boolean).join("\n");
      const guarded = guardPostingHtml(html);
      const location = formatLocation(d.location?.city, d.location?.region, d.location?.country);
      const remote = Boolean(d.remote) || d.location?.workplace_type === "remote" || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(d.title);
      return {
        atsType: "workable",
        externalId: d.shortcode || externalId,
        companyName: prettifyToken(token),
        companyToken: token,
        title: d.title.trim(),
        location,
        remote,
        descriptionText: htmlToText(guarded.cleanedHtml) || d.title,
        descriptionHtml: guarded.cleanedHtml || undefined,
        applyUrl: `https://apply.workable.com/${token}/j/${d.shortcode || externalId}/`,
        postedAt: parseDate(d.published),
        discoveredVia: "feed",
        raw: d,
      };
    }
    const list = await workable.fetchJobs(token);
    return list.find((j) => j.externalId === externalId) ?? null;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(?:apply|jobs)\.workable\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[2] === "widget" && parts[3] === "accounts" && parts[4]) {
      return { token: parts[4] };
    }
    if (!parts[0] || parts[0] === "j") return null;
    const token = parts[0];
    if (!SLUG_RE.test(token)) return null;
    const externalId = parts[1] === "j" && parts[2] ? parts[2] : undefined;
    return { token, externalId };
  },
};
