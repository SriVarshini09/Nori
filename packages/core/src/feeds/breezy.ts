import type { NormalizedJob } from "../contracts.js";
import { htmlToText } from "./html.js";
import { getJson, parseDate, prettifyToken, REMOTE_RE, safeUrl, type FeedSourceExt } from "./http.js";
import { guardPostingHtml } from "./posting-guard.js";

/**
 * Breezy HR adapter — modeled on career-ops-hq/career-ops (providers/breezy.mjs):
 *   GET https://<slug>.breezy.hr/json
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

type BreezyJob = {
  id?: string;
  friendly_id?: string;
  name?: string;
  url?: string;
  published_date?: string;
  description?: string;
  company?: { name?: string };
  location?: { name?: string; city?: string; state?: { name?: string }; country?: { name?: string }; is_remote?: boolean };
};

export const breezy: FeedSourceExt = {
  atsType: "breezy",
  async fetchJobs(token) {
    const slug = token.toLowerCase();
    if (!SLUG_RE.test(slug)) return [];
    const items = await getJson<BreezyJob[]>(`https://${slug}.breezy.hr/json`).catch(() => null);
    if (!Array.isArray(items)) return [];

    const out: NormalizedJob[] = [];
    for (const j of items) {
      const id = String(j.friendly_id || j.id || "").trim();
      const title = j.name?.trim();
      if (!id || !title) continue;
      const guarded = guardPostingHtml(j.description ?? "");
      const location = j.location?.name || [j.location?.city, j.location?.state?.name, j.location?.country?.name].filter(Boolean).join(", ") || undefined;
      const remote = Boolean(j.location?.is_remote) || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title);
      out.push({
        atsType: "breezy",
        externalId: id,
        companyName: j.company?.name?.trim() || prettifyToken(slug),
        companyToken: slug,
        title,
        location,
        remote,
        descriptionText: htmlToText(guarded.cleanedHtml) || title,
        descriptionHtml: guarded.cleanedHtml || undefined,
        applyUrl: j.url || `https://${slug}.breezy.hr/p/${id}`,
        postedAt: parseDate(j.published_date),
        discoveredVia: "feed",
        raw: j,
      });
    }
    return out;
  },

  parseUrl(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const m = /^([a-z0-9][a-z0-9-]*)\.breezy\.hr$/i.exec(u.hostname);
    if (!m) return null;
    const token = m[1]!.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const externalId = parts[0] === "p" && parts[1] ? parts[1] : undefined;
    return { token, externalId };
  },
};
