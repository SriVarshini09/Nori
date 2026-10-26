import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Rippling v2 ATS adapter — modeled on career-ops-hq/career-ops (providers/rippling.mjs):
 *   GET https://ats.rippling.com/api/v2/board/<slug>/jobs?page=<n>&pageSize=1000
 */

const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

type RipplingLocation = {
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  workplaceType?: string;
};

type RipplingItem = {
  id?: string;
  uuid?: string;
  name?: string;
  url?: string;
  description?: string | { role?: string; company?: string };
  department?: { name?: string };
  locations?: RipplingLocation[];
  workLocations?: string[];
};

type RipplingBoardResponse = {
  items?: RipplingItem[];
  totalPages?: number;
};

function locationOf(item: RipplingItem): { location?: string; remote: boolean } {
  const locs = (item.locations ?? [])
    .map((l) => l.name || [l.city, l.state, l.country].filter(Boolean).join(", "))
    .filter(Boolean);
  const workLocs = (item.workLocations ?? []).filter(Boolean);
  const all = [...new Set([...locs, ...workLocs])];
  const location = all.join(" | ") || undefined;
  const remote = Boolean(
    (item.locations ?? []).some((l) => /remote/i.test(l.workplaceType ?? "") || REMOTE_RE.test(l.name ?? "")) ||
    REMOTE_RE.test(location ?? ""),
  );
  return { location, remote };
}

function descriptionOf(item: RipplingItem): { text: string; html?: string } {
  if (typeof item.description === "string" && item.description.trim()) {
    const guarded = guardPostingHtml(item.description);
    return { text: htmlToText(guarded.cleanedHtml), html: guarded.cleanedHtml };
  }
  if (item.description && typeof item.description === "object") {
    const combined = [item.description.company, item.description.role].filter(Boolean).join("\n\n");
    const guarded = guardPostingHtml(combined);
    return { text: htmlToText(guarded.cleanedHtml), html: guarded.cleanedHtml || undefined };
  }
  return { text: [item.name, item.department?.name].filter(Boolean).join(" — ") };
}

export const rippling: FeedSourceExt = {
  atsType: "rippling",
  async fetchJobs(token) {
    if (!SLUG_RE.test(token)) return [];
    const out: NormalizedJob[] = [];
    const seen = new Set<string>();
    const companyName = prettifyToken(token.replace(/-jobs$/i, ""));

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await getJson<RipplingBoardResponse>(
        `https://ats.rippling.com/api/v2/board/${encodeURIComponent(token)}/jobs?page=${page}&pageSize=${PAGE_SIZE}`,
      ).catch(() => null);
      if (!data?.items?.length) break;

      for (const item of data.items) {
        const id = String(item.id || item.uuid || "").trim();
        const title = item.name?.trim();
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
        const { location, remote } = locationOf(item);
        const desc = descriptionOf(item);
        const applyUrl = item.url || `https://ats.rippling.com/${token}/jobs/${id}`;
        out.push({
          atsType: "rippling",
          externalId: id,
          companyName,
          companyToken: token,
          title,
          location,
          remote: remote || REMOTE_RE.test(title),
          descriptionText: desc.text || title,
          descriptionHtml: desc.html,
          applyUrl,
          discoveredVia: "feed",
          raw: item,
        });
      }

      if (data.items.length < PAGE_SIZE) break;
      if (typeof data.totalPages === "number" && page + 1 >= data.totalPages) break;
    }
    return out;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^ats\.rippling\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1] === "v2" && parts[2] === "board" && parts[3]) {
      return { token: parts[3] };
    }
    // Embedded Locale prefix e.g. /en-US/<slug>/jobs/<id>
    const startIdx = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(parts[0] ?? "") ? 1 : 0;
    const token = parts[startIdx];
    if (!token || !SLUG_RE.test(token)) return null;
    const externalId = parts[startIdx + 1] === "jobs" && parts[startIdx + 2] ? parts[startIdx + 2] : undefined;
    return { token, externalId };
  },
};
