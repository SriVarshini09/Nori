import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * BambooHR adapter — modeled on career-ops-hq/career-ops (providers/bamboohr.mjs):
 *   - List API: GET https://<tenant>.bamboohr.com/careers/list
 *   - Detail API: GET https://<tenant>.bamboohr.com/careers/<id>/detail
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
const MAX_DETAIL_CONCURRENCY = 5;

type BambooListItem = {
  id?: string | number;
  jobOpeningName?: string;
  departmentLabel?: string;
  location?: { city?: string; state?: string; country?: string };
  atsLocation?: { country?: string; state?: string; city?: string };
  isRemote?: boolean | number;
  locationType?: string | number;
};

type BambooDetailResponse = {
  result?: {
    jobOpening?: {
      jobOpeningShareUrl?: string;
      jobOpeningName?: string;
      departmentLabel?: string;
      description?: string;
      datePosted?: string;
      location?: { city?: string; state?: string; country?: string };
      isRemote?: boolean | number;
    };
  };
};

function formatBambooLoc(item: BambooListItem): string | undefined {
  const loc = item.location ?? item.atsLocation;
  if (!loc) return undefined;
  return [loc.city, loc.state, loc.country].map((s) => s?.trim()).filter(Boolean).join(", ") || undefined;
}

export const bamboohr: FeedSourceExt = {
  atsType: "bamboohr",
  async fetchJobs(token) {
    const slug = token.toLowerCase();
    if (!SLUG_RE.test(slug)) return [];
    const data = await getJson<{ result?: BambooListItem[] }>(
      `https://${slug}.bamboohr.com/careers/list`,
      { headers: { accept: "application/json" } },
    ).catch(() => null);
    const items = data?.result ?? [];
    if (!items.length) return [];

    const companyName = prettifyToken(slug);
    const queue = items.slice(0, 100);
    const out: NormalizedJob[] = [];

    const workers = Array.from({ length: Math.min(MAX_DETAIL_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const id = String(item.id ?? "").trim();
        const title = item.jobOpeningName?.trim();
        if (!id || !title) continue;

        const detail = await getJson<BambooDetailResponse>(
          `https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`,
          { headers: { accept: "application/json" } },
        ).catch(() => null);

        const opening = detail?.result?.jobOpening;
        const rawHtml = opening?.description ?? "";
        const guarded = guardPostingHtml(rawHtml);
        const location = formatBambooLoc(item);
        const remote = Boolean(item.isRemote) || item.locationType === "1" || item.locationType === 1 || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title);
        const applyUrl = opening?.jobOpeningShareUrl || `https://${slug}.bamboohr.com/careers/${id}`;

        out.push({
          atsType: "bamboohr",
          externalId: id,
          companyName,
          companyToken: slug,
          title,
          location,
          remote,
          descriptionText: htmlToText(guarded.cleanedHtml) || [title, item.departmentLabel, location].filter(Boolean).join(" — "),
          descriptionHtml: guarded.cleanedHtml || undefined,
          applyUrl,
          postedAt: parseDate(opening?.datePosted),
          discoveredVia: "feed",
          raw: opening ?? item,
        });
      }
    });
    await Promise.all(workers);
    return out;
  },

  async fetchJob(token, externalId) {
    const slug = token.toLowerCase();
    if (!SLUG_RE.test(slug)) return null;
    const detail = await getJson<BambooDetailResponse>(
      `https://${slug}.bamboohr.com/careers/${encodeURIComponent(externalId)}/detail`,
      { headers: { accept: "application/json" } },
    ).catch(() => null);
    const opening = detail?.result?.jobOpening;
    if (!opening?.jobOpeningName) return null;
    const guarded = guardPostingHtml(opening.description ?? "");
    const loc = opening.location;
    const location = loc ? [loc.city, loc.state, loc.country].filter(Boolean).join(", ") || undefined : undefined;
    return {
      atsType: "bamboohr",
      externalId: String(externalId),
      companyName: prettifyToken(slug),
      companyToken: slug,
      title: opening.jobOpeningName.trim(),
      location,
      remote: Boolean(opening.isRemote) || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(opening.jobOpeningName),
      descriptionText: htmlToText(guarded.cleanedHtml) || opening.jobOpeningName,
      descriptionHtml: guarded.cleanedHtml || undefined,
      applyUrl: opening.jobOpeningShareUrl || `https://${slug}.bamboohr.com/careers/${externalId}`,
      postedAt: parseDate(opening.datePosted),
      discoveredVia: "feed",
      raw: opening,
    };
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const m = /^([a-z0-9][a-z0-9-]*)\.bamboohr\.com$/i.exec(u.hostname);
    if (!m) return null;
    const token = m[1]!.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const externalId = (parts[0] === "careers" || parts[0] === "jobs") && parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : undefined;
    return { token, externalId };
  },
};
